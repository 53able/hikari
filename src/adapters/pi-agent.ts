import { z } from 'zod';
import { capabilitySchemaToJson } from '../core/cap-meta.js';
import { Agent, type AgentTool, type AgentOptions, type AgentMessage } from '@earendil-works/pi-agent-core';
import { streamSimple, type Model, type Usage, type Api } from '@earendil-works/pi-ai';
import type { TSchema } from 'typebox';
import type { Registry } from '../core/registry.js';
import {
  formatToolExecutionError,
  type ToolExecutionErrorPayload,
} from '../core/tool-error.js';
import { ValidationError } from '../core/execution.js';
import type { Engine, ExecutionOptions } from '../core/execution.js';
import type { HarnessTracer } from '../core/harness-trace.js';
import { buildLlmChatHistory, type LlmContextOptions } from '../agent/context.js';
import { enrichExecutionOptionsWithIdempotency } from '../core/idempotency-key.js';
import {
  resolvePiModelFromEnv,
  resolvePiGetApiKey,
  resolveAgentPromptFromEnv,
} from './pi-model.js';

/** `createHikariAgent` の設定オプション。 */
export interface HikariAgentOptions {
  /** LLM プロバイダ。省略時は `HIKARI_PI_PROVIDER` または `anthropic`。 */
  provider?: string;
  /** モデル ID。省略時は `HIKARI_PI_MODEL` または `claude-sonnet-4-6`。 */
  modelId?: string;
  /** エージェントのシステムプロンプト本文。未指定時は `resolveAgentPromptFromEnv`。 */
  systemPrompt?: string;
  /** API キー（主に Anthropic）。省略時は環境変数から解決。 */
  apiKey?: string;
  /** harness 層の intent / plan / tool 選択ログ。 */
  harness?: HarnessTracer;
  /** Pi プロバイダ向けセッション ID（キャッシュ相関用）。 */
  sessionId?: string;
  /** `transformContext` で適用する履歴トリム設定。 */
  contextOptions?: LlmContextOptions;
  /** Pi Agent コアへ直接渡す追加オプション（`initialState` / `streamFn` / `getApiKey` / `transformContext` / `sessionId` を除く）。 */
  agentOptions?: Omit<
    AgentOptions,
    'initialState' | 'streamFn' | 'getApiKey' | 'transformContext' | 'sessionId'
  >;
}

/** Pi `Agent` の型エイリアス。 */
export type HikariAgent = Agent;

/** `toAgentTools` / Agent 生成時に参照する実行コンテキスト。 */
export type PiToolExecutionContext = Omit<ExecutionOptions, 'intent'> & {
  intent?: string;
};

/** `toAgentTools` の harness / 動的コンテキスト設定。 */
export type PiToolBindings = {
  readonly getContext: () => PiToolExecutionContext;
  readonly harness?: HarnessTracer;
  readonly resolveIntent?: (toolCallId: string, capabilityName: string, params: unknown) => string;
};

/** Pi ツール結果 `details` に含める trace 相関用ペイロード。 */
export type PiToolResultDetails = {
  output?: unknown;
  traceId: string;
  error?: ToolExecutionErrorPayload;
};

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const truncateText = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;

/**
 * Pi `AgentMessage` 履歴を件数・文字数で切り詰める（`transformContext` 用）。
 */
export const trimAgentMessagesForContext = (
  messages: AgentMessage[],
  options: LlmContextOptions = {},
): AgentMessage[] => {
  const maxMessages = options.maxMessages ?? 40;
  const maxChars = options.maxCharsPerMessage ?? 8000;
  return messages.slice(-maxMessages).map((message) => {
    if (message.role === 'user' && typeof message.content === 'string') {
      return { ...message, content: truncateText(message.content, maxChars) };
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === 'text' && typeof block.text === 'string'
            ? { ...block, text: truncateText(block.text, maxChars) }
            : block,
        ),
      };
    }
    return message;
  });
};

/**
 * チャット履歴を Pi `AgentMessage` 配列へ変換する。
 */
export const chatHistoryToAgentMessages = (
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>,
  model: Model<Api>,
): AgentMessage[] =>
  history.map((message) => {
    if (message.role === 'user') {
      return {
        role: 'user',
        content: message.content,
        timestamp: message.timestamp.getTime(),
      };
    }
    return {
      role: 'assistant',
      content: [{ type: 'text', text: message.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: EMPTY_USAGE,
      stopReason: 'stop',
      timestamp: message.timestamp.getTime(),
    };
  });

/**
 * ユーザーメッセージから harness / 監査向け intent 文字列を切り出す。
 */
export const intentSnippetFromMessage = (message: string, maxLen = 200): string =>
  message.length <= maxLen ? message : `${message.slice(0, maxLen)}…`;

/**
 * Hikari ケイパビリティを Pi `AgentTool` 配列に変換する。
 */
export function toAgentTools(
  registry: Registry,
  engine: Engine,
  bindings: PiToolBindings,
): AgentTool[] {
  return registry.listForLlm().map((cap): AgentTool => ({
    name: cap.name,
    description: cap.description,
    label: cap.name,
    parameters: capabilitySchemaToJson(cap.inputSchema) as unknown as TSchema,
    execute: async (toolCallId, params) => {
      const ctx = bindings.getContext();
      const traceId = ctx.traceId ?? toolCallId;
      const intent =
        bindings.resolveIntent?.(toolCallId, cap.name, params) ?? ctx.intent ?? toolCallId;

      const parsed = cap.inputSchema.safeParse(params);
      if (!parsed.success) {
        const validationErr = new ValidationError(
          parsed.error.issues.map((issue: z.ZodIssue) => ({
            message: issue.message,
            path: issue.path.filter(
              (segment): segment is string | number => typeof segment !== 'symbol',
            ),
          })),
          cap.name,
          'input',
        );
        const errorPayload = formatToolExecutionError(validationErr);
        const details: PiToolResultDetails = { traceId, error: errorPayload };
        return {
          content: [{ type: 'text', text: JSON.stringify(errorPayload) }],
          details,
          isError: true,
        };
      }

      try {
        const execOptions = enrichExecutionOptionsWithIdempotency(
          registry,
          cap.name,
          {
            userId: ctx.userId,
            sessionId: ctx.sessionId,
            traceId,
            intent,
            permissions: ctx.permissions,
            idempotencyKey: ctx.idempotencyKey,
          },
          { toolCallId },
        );
        const result = await engine.execute(cap.name, parsed.data, execOptions);
        const details: PiToolResultDetails = {
          output: result.output,
          traceId: result.traceId,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result.output) }],
          details,
        };
      } catch (err) {
        const errorPayload = formatToolExecutionError(err);
        const details: PiToolResultDetails = {
          traceId,
          error: errorPayload,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(errorPayload) }],
          details,
          isError: true,
        };
      }
    },
  }));
}

/**
 * 全 Hikari ケイパビリティをツールとして持つ Pi Agent を生成する。
 */
export function createHikariAgent(
  registry: Registry,
  engine: Engine,
  getContext: () => PiToolExecutionContext,
  options: HikariAgentOptions = {},
): HikariAgent {
  const {
    provider,
    modelId,
    systemPrompt = resolveAgentPromptFromEnv(),
    apiKey,
    harness,
    sessionId: optionSessionId,
    contextOptions,
    agentOptions = {},
  } = options;

  const resolved = resolvePiModelFromEnv({ provider, modelId });
  const getApiKey = resolvePiGetApiKey(apiKey);
  const tools = toAgentTools(registry, engine, {
    getContext,
    harness,
    resolveIntent: (toolCallId) => getContext().intent ?? toolCallId,
  });

  const sessionId = optionSessionId ?? getContext().sessionId;

  return new Agent({
    ...agentOptions,
    getApiKey,
    sessionId,
    transformContext: async (messages) =>
      trimAgentMessagesForContext(messages, contextOptions),
    streamFn: (m, ctx, opts) => streamSimple(m, ctx, opts),
    initialState: {
      model: resolved.model,
      tools,
      systemPrompt,
    },
  });
}

/**
 * 固定の `ExecutionOptions` で Pi Agent を生成する。
 */
export function createHikariAgentWithOptions(
  registry: Registry,
  engine: Engine,
  executionOptions: PiToolExecutionContext,
  options: HikariAgentOptions = {},
): HikariAgent {
  const contextRef = { current: executionOptions };
  return createHikariAgent(registry, engine, () => contextRef.current, options);
}

/** Pi ツール結果から engine の `traceId` を取り出す。 */
export const traceIdFromPiToolResult = (result: unknown): string | undefined => {
  if (!result || typeof result !== 'object') return undefined;
  const details = (result as { details?: PiToolResultDetails }).details;
  if (details?.traceId && typeof details.traceId === 'string') return details.traceId;
  const direct = (result as PiToolResultDetails).traceId;
  return typeof direct === 'string' ? direct : undefined;
};
