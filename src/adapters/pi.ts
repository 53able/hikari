import { randomUUID } from 'node:crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Agent, type AgentTool, type AgentOptions, type AgentMessage } from '@earendil-works/pi-agent-core';
import { streamSimple, getModel, type Model, type Usage } from '@earendil-works/pi-ai';
import type { TSchema } from 'typebox';
import type { Registry } from '../core/registry.js';
import type { CapabilityRuntime } from '../core/capability.js';
import type { Engine, ExecutionOptions } from '../core/execution.js';
import { createEngine } from '../core/execution.js';
import type { AuditLogger } from '../core/audit.js';
import type { ApprovalGate } from '../core/approval.js';
import type { IdempotencyStore } from '../core/idempotency-store.js';
import { createHarnessTracer, type HarnessTracer } from '../core/harness-trace.js';
import {
  buildHarnessPlanFromToolCalls,
  harnessPlanStepsMetadata,
  type HarnessPlanStep,
} from '../core/harness-plan.js';

/** `createHikariAgent` の設定オプション。 */
export interface HikariAgentOptions {
  /** 使用する Anthropic モデルID。デフォルト: `'claude-sonnet-4-6'`。 */
  modelId?: string;
  /** エージェントのシステムプロンプト。 */
  systemPrompt?: string;
  /** Anthropic API キー。省略時は `ANTHROPIC_API_KEY` 環境変数を使用する。 */
  apiKey?: string;
  /** harness 層の intent / plan / tool 選択ログ。 */
  harness?: HarnessTracer;
  /** Pi Agent コアへ直接渡す追加オプション（`initialState` と `streamFn` を除く）。 */
  agentOptions?: Omit<AgentOptions, 'initialState' | 'streamFn'>;
}

/** Pi `Agent` の型エイリアス。`createHikariAgent` で生成されたインスタンスは Hikari ケイパビリティをツールとして持つ。 */
export type HikariAgent = Agent;

/** `toAgentTools` / Agent 生成時に参照する実行コンテキスト。 */
export type PiToolExecutionContext = Omit<ExecutionOptions, 'intent'> & {
  intent?: string;
};

/** `toAgentTools` の harness / 動的コンテキスト設定。 */
export type PiToolBindings = {
  /** 現在のターンで engine に渡す識別情報。 */
  readonly getContext: () => PiToolExecutionContext;
  /** harness 層トレーサー。 */
  readonly harness?: HarnessTracer;
  /** 監査 intent。未指定時は `toolCallId` を使用する。 */
  readonly resolveIntent?: (toolCallId: string, capabilityName: string, params: unknown) => string;
};

/** Pi ツール結果 `details` に含める trace 相関用ペイロード。 */
export type PiToolResultDetails = {
  output?: unknown;
  traceId: string;
  error?: string;
};

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * チャット履歴を Pi `AgentMessage` 配列へ変換する。
 * assistant 行はモデルメタデータを補完した最小構成で渡す。
 */
export const chatHistoryToAgentMessages = (
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>,
  model: Model<any>,
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
 * 各ツールの `execute` は Hikari エンジンに委譲するため、ポリシー評価・承認ゲート・監査ログがすべて保持される。
 */
export function toAgentTools(
  registry: Registry,
  engine: Engine,
  bindings: PiToolBindings,
): AgentTool[] {
  return registry.getAll().map((cap): AgentTool => {
    const jsonSchema = zodToJsonSchema(cap.inputSchema, { target: 'openApi3' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { $schema, ...parameters } = jsonSchema as Record<string, unknown>;

    return {
      name: cap.name,
      description: cap.description,
      label: cap.name,
      parameters: parameters as unknown as TSchema,
      execute: async (toolCallId, params) => {
        const ctx = bindings.getContext();
        const traceId = ctx.traceId ?? toolCallId;
        const intent =
          bindings.resolveIntent?.(toolCallId, cap.name, params) ?? ctx.intent ?? toolCallId;

        try {
          const result = await engine.execute(cap.name, params, {
            userId: ctx.userId,
            sessionId: ctx.sessionId,
            traceId,
            intent,
            permissions: ctx.permissions,
          });
          const details: PiToolResultDetails = {
            output: result.output,
            traceId: result.traceId,
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(result.output) }],
            details,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(message);
        }
      },
    };
  });
}

/**
 * 全 Hikari ケイパビリティをツールとして持つ Pi Agent を生成する。
 *
 * @param registry - ツール定義のソース。
 * @param engine - ツール呼び出しを実行するエンジン。
 * @param getContext - ツール実行時に参照する実行コンテキストを返す関数。
 * @param options - モデル・システムプロンプト・APIキー・harness などの追加設定。
 */
export function createHikariAgent(
  registry: Registry,
  engine: Engine,
  getContext: () => PiToolExecutionContext,
  options: HikariAgentOptions = {},
): HikariAgent {
  const {
    modelId = 'claude-sonnet-4-6',
    systemPrompt = 'You are a helpful assistant with access to registered capabilities.',
    apiKey,
    harness,
    agentOptions = {},
  } = options;

  const model = getModel('anthropic', modelId as 'claude-sonnet-4-6');
  const tools = toAgentTools(registry, engine, {
    getContext,
    harness,
    resolveIntent: (toolCallId) => getContext().intent ?? toolCallId,
  });

  return new Agent({
    ...agentOptions,
    streamFn: (m, ctx, opts) =>
      streamSimple(m, ctx, { ...opts, apiKey }),
    initialState: {
      model,
      tools,
      systemPrompt,
    },
  });
}

/**
 * 固定の `ExecutionOptions` で Pi Agent を生成する（CLI / サンプル向け）。
 * ターンごとに `traceId` や `intent` を変える場合は `getContext` 版の `createHikariAgent` を使う。
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

/** `createHikariHarness` の依存関係。 */
export type HikariHarnessDeps = {
  readonly registry: Registry;
  readonly auditLog: AuditLogger;
  readonly approvalGate?: ApprovalGate;
  readonly idempotencyStore?: IdempotencyStore;
  readonly runtime?: CapabilityRuntime;
  readonly agentOptions?: HikariAgentOptions;
  /** `buildHarnessPlanFromToolCalls` のプラン文プレフィックス。 */
  readonly planPrefix?: string;
};

/** Pi harness + Hikari engine を束ねた実行面。 */
export type HikariHarness = {
  readonly agent: HikariAgent;
  readonly harness: HarnessTracer;
  readonly engine: Engine;
  readonly runTurn: (input: {
    readonly message: string;
    readonly context: PiToolExecutionContext;
  }) => Promise<{ readonly traceId: string }>;
};

type PiAgentEvent = {
  readonly type: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
};

/**
 * Pi Agent と Hikari engine を統合する harness 層。
 * intent / plan はターン単位で 1 回ずつ記録し、tool 選択は engine（`tool-only`）側で記録する。
 */
export const createHikariHarness = (deps: HikariHarnessDeps): HikariHarness => {
  const harness = createHarnessTracer(deps.auditLog, { registry: deps.registry });
  const engine = createEngine({
    registry: deps.registry,
    auditLog: deps.auditLog,
    approvalGate: deps.approvalGate,
    idempotencyStore: deps.idempotencyStore,
    runtime: deps.runtime,
    harness,
    harnessMode: 'tool-only',
  });

  const contextRef: { current: PiToolExecutionContext } = {
    current: { userId: 'anonymous' },
  };
  const planStepsRef: { steps: HarnessPlanStep[]; order: number } = {
    steps: [],
    order: 0,
  };

  const agent = createHikariAgent(deps.registry, engine, () => contextRef.current, {
    ...deps.agentOptions,
    harness: undefined,
  });

  agent.subscribe((event) => {
    const agentEvent = event as PiAgentEvent;
    if (agentEvent.type !== 'tool_execution_start' || !agentEvent.toolName) return;
    planStepsRef.steps.push({
      capabilityName: agentEvent.toolName,
      order: planStepsRef.order,
      ...(agentEvent.toolCallId !== undefined ? { toolCallId: agentEvent.toolCallId } : {}),
    });
    planStepsRef.order += 1;
  });

  const runTurn = async (input: {
    message: string;
    context: PiToolExecutionContext;
  }): Promise<{ traceId: string }> => {
    const traceId = input.context.traceId ?? randomUUID();
    const intent = input.context.intent ?? intentSnippetFromMessage(input.message);
    planStepsRef.steps = [];
    planStepsRef.order = 0;
    contextRef.current = {
      ...input.context,
      traceId,
      intent,
    };

    await harness.recordIntent({
      traceId,
      userId: input.context.userId,
      sessionId: input.context.sessionId,
      intent,
    });

    agent.reset();
    await agent.prompt(input.message);
    await agent.waitForIdle();

    const steps = [...planStepsRef.steps];
    await harness.recordPlan({
      traceId,
      userId: input.context.userId,
      sessionId: input.context.sessionId,
      intent,
      plan: buildHarnessPlanFromToolCalls(steps, { prefix: deps.planPrefix }),
      metadata: harnessPlanStepsMetadata(steps),
    });

    return { traceId };
  };

  return { agent, harness, engine, runTurn };
};
