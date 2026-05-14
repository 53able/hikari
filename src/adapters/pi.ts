import { zodToJsonSchema } from 'zod-to-json-schema';
import { Agent, type AgentTool, type AgentOptions } from '@earendil-works/pi-agent-core';
import { streamSimple, getModel } from '@earendil-works/pi-ai';
import type { TSchema } from 'typebox';
import type { Registry } from '../core/registry.js';
import type { Engine, ExecutionOptions } from '../core/execution.js';

/** `createHikariAgent` の設定オプション。 */
export interface HikariAgentOptions {
  /** 使用する Anthropic モデルID。デフォルト: `'claude-sonnet-4-6'`。 */
  modelId?: string;
  /** エージェントのシステムプロンプト。 */
  systemPrompt?: string;
  /** Anthropic API キー。省略時は `ANTHROPIC_API_KEY` 環境変数を使用する。 */
  apiKey?: string;
  /** Pi Agent コアへ直接渡す追加オプション（`initialState` と `streamFn` を除く）。 */
  agentOptions?: Omit<AgentOptions, 'initialState' | 'streamFn'>;
}

/** Pi `Agent` の型エイリアス。`createHikariAgent` で生成されたインスタンスは Hikari ケイパビリティをツールとして持つ。 */
export type HikariAgent = Agent;

/**
 * Hikari ケイパビリティを Pi `AgentTool` 配列に変換する。
 * 各ツールの `execute` は Hikari エンジンに委譲するため、ポリシー評価・承認ゲート・監査ログがすべて保持される。
 */
export function toAgentTools(
  registry: Registry,
  engine: Engine,
  executionOptions: Omit<ExecutionOptions, 'intent'>,
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
        const result = await engine.execute(cap.name, params, {
          ...executionOptions,
          intent: toolCallId,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result.output) }],
          details: result.output,
        };
      },
    };
  });
}

/**
 * 全 Hikari ケイパビリティをツールとして持つ Pi Agent を生成する。
 *
 * @param registry - ツール定義のソース。
 * @param engine - ツール呼び出しを実行するエンジン。
 * @param executionOptions - 全ツール呼び出しに適用されるユーザー識別情報と権限（`intent` を除く）。
 * @param options - モデル・システムプロンプト・APIキーなどの追加設定。
 */
export function createHikariAgent(
  registry: Registry,
  engine: Engine,
  executionOptions: Omit<ExecutionOptions, 'intent'>,
  options: HikariAgentOptions = {},
): HikariAgent {
  const {
    modelId = 'claude-sonnet-4-6',
    systemPrompt = 'You are a helpful assistant with access to registered capabilities.',
    apiKey,
    agentOptions = {},
  } = options;

  const model = getModel('anthropic', modelId as 'claude-sonnet-4-6');
  const tools = toAgentTools(registry, engine, executionOptions);

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
