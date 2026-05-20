import Anthropic from '@anthropic-ai/sdk';
import type { Registry } from '../core/registry.js';
import { capabilitySchemaToJson } from '../core/cap-meta.js';
import type { Engine, ExecutionOptions } from '../core/execution.js';
import { serializeToolExecutionError } from '../core/tool-error.js';
import { enrichExecutionOptionsWithIdempotency } from '../core/idempotency-key.js';

/** Anthropic API への単一チャットターンに渡すオプション。`ExecutionOptions` を継承する。 */
export interface ChatOptions extends ExecutionOptions {
  /** 使用するモデルID。デフォルト: `'claude-sonnet-4-6'`。 */
  model?: string;
  /** 最大生成トークン数。デフォルト: `4096`。 */
  maxTokens?: number;
}

/** 完了したチャットターンの結果。 */
export interface ChatResult {
  /** モデルが最終的に生成したテキスト。ツール呼び出しが複数あった場合もまとめて結合される。 */
  content: string;
  /** このターンで実行された全ケイパビリティのトレースID一覧。監査ログ参照に使用する。 */
  traceIds: string[];
}

/**
 * Hikari レジストリとエンジンを Anthropic ツール呼び出し対応のチャットクライアントとしてラップする。
 *
 * ケイパビリティが Anthropic ツール定義になり、ツール呼び出し結果はエンジン経由で実行されるため
 * ポリシーチェック・承認・監査がすべて保持される。
 */
export type ClaudeAdapter = {
  /** 登録済みケイパビリティから Anthropic ツール定義配列を生成する。 */
  readonly getTools: () => Anthropic.Tool[];
  /**
   * Anthropic API にメッセージを送信し、ツール呼び出しループを処理してテキスト応答を返す。
   * @param messages - 会話履歴（user/assistant ペア）。
   * @param options - 呼び出し元の識別情報、権限、モデル設定。
   */
  readonly chat: (
    messages: Anthropic.MessageParam[],
    options: ChatOptions,
  ) => Promise<ChatResult>;
};

/**
 * 登録済みケイパビリティを全て Anthropic ツールとして公開する `ClaudeAdapter` を生成する。
 *
 * @param registry - ツール定義生成のソースとなるレジストリ。
 * @param engine - モデルのツール呼び出しを実行するエンジン。
 * @param apiKey - Anthropic API キー。省略時は `ANTHROPIC_API_KEY` 環境変数を使用する。
 */
export function createClaudeAdapter(
  registry: Registry,
  engine: Engine,
  apiKey?: string,
): ClaudeAdapter {
  const client = new Anthropic({ apiKey });

  const getTools = (): Anthropic.Tool[] =>
    registry.listForLlm().map((cap) => ({
      name: cap.name,
      description: cap.description,
      input_schema: capabilitySchemaToJson(cap.inputSchema) as Anthropic.Tool['input_schema'],
    }));

  const chat = async (
    messages: Anthropic.MessageParam[],
    options: ChatOptions,
  ): Promise<ChatResult> => {
    const tools = getTools();
    const traceIds: string[] = [];
    const conversation: Anthropic.MessageParam[] = [...messages];
    const model = options.model ?? 'claude-sonnet-4-6';
    const maxTokens = options.maxTokens ?? 4096;

    let response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      tools,
      messages: conversation,
    });

    const MAX_TOOL_ITERATIONS = 10;
    const deadline = Date.now() + 60_000;
    let iterations = 0;

    while (response.stop_reason === 'tool_use') {
      if (++iterations > MAX_TOOL_ITERATIONS) {
        throw new Error(`Tool-use iteration cap (${MAX_TOOL_ITERATIONS}) exceeded`);
      }
      if (Date.now() > deadline) {
        throw new Error('Chat deadline (60s) exceeded');
      }
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        try {
          const execOptions = enrichExecutionOptionsWithIdempotency(
            registry,
            toolUse.name,
            {
              ...options,
              intent: options.intent ?? extractLastUserMessage(messages),
            },
            { toolCallId: toolUse.id },
          );
          const result = await engine.execute(toolUse.name, toolUse.input, execOptions);
          traceIds.push(result.traceId);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result.output),
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: serializeToolExecutionError(err),
            is_error: true,
          });
        }
      }

      conversation.push(
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      );

      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        tools,
        messages: conversation,
      });
    }

    const content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return { content, traceIds };
  };

  return { getTools, chat };
}

function extractLastUserMessage(messages: Anthropic.MessageParam[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') return msg.content;
    const textBlock = msg.content.find(
      (b): b is Anthropic.TextBlockParam => b.type === 'text',
    );
    if (textBlock) return textBlock.text;
  }
  return undefined;
}
