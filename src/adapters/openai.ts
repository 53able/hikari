import OpenAI from 'openai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Registry } from '../core/registry.js';
import type { Engine } from '../core/execution.js';
import { serializeToolExecutionError } from '../core/tool-error.js';
import { enrichExecutionOptionsWithIdempotency } from '../core/idempotency-key.js';
import type { ChatOptions, ChatResult } from './claude.js';

/** OpenAI Chat Completions に渡す会話メッセージ（user / assistant のテキストのみ）。 */
export type OpenAiChatMessage = {
  readonly role: 'user' | 'assistant';
  readonly content: string;
};

/**
 * Hikari レジストリとエンジンを OpenAI 関数呼び出し対応のチャットクライアントとしてラップする。
 *
 * ケイパビリティが OpenAI ツール定義になり、ツール呼び出し結果はエンジン経由で実行されるため
 * ポリシーチェック・承認・監査がすべて保持される。
 */
export type OpenAiAdapter = {
  /** 登録済みケイパビリティから OpenAI ツール定義配列を生成する。 */
  readonly getTools: () => OpenAI.Chat.Completions.ChatCompletionTool[];
  /**
   * OpenAI API にメッセージを送信し、ツール呼び出しループを処理してテキスト応答を返す。
   * @param messages - 会話履歴（user/assistant ペア）。
   * @param options - 呼び出し元の識別情報、権限、モデル設定。
   */
  readonly chat: (
    messages: readonly OpenAiChatMessage[],
    options: ChatOptions,
  ) => Promise<ChatResult>;
};

/**
 * 登録済みケイパビリティを全て OpenAI ツールとして公開する `OpenAiAdapter` を生成する。
 *
 * @param registry - ツール定義生成のソースとなるレジストリ。
 * @param engine - モデルのツール呼び出しを実行するエンジン。
 * @param apiKey - OpenAI API キー。省略時は `OPENAI_API_KEY` 環境変数を使用する。
 */
export const createOpenAiAdapter = (
  registry: Registry,
  engine: Engine,
  apiKey?: string,
): OpenAiAdapter => {
  const client = new OpenAI({ apiKey });

  const getTools = (): OpenAI.Chat.Completions.ChatCompletionTool[] =>
    registry.listForLlm().map((cap) => {
      const jsonSchema = zodToJsonSchema(cap.inputSchema, { target: 'openApi3' });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { $schema, ...parameters } = jsonSchema as Record<string, unknown>;
      return {
        type: 'function',
        function: {
          name: cap.name,
          description: cap.description,
          parameters,
        },
      };
    });

  const toApiMessages = (
    messages: readonly OpenAiChatMessage[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] =>
    messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const chat = async (
    messages: readonly OpenAiChatMessage[],
    options: ChatOptions,
  ): Promise<ChatResult> => {
    const tools = getTools();
    const traceIds: string[] = [];
    const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      toApiMessages(messages);
    const model = options.model ?? 'gpt-4o-mini';
    const maxTokens = options.maxTokens ?? 4096;

    let response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      tools: tools.length > 0 ? tools : undefined,
      messages: conversation,
    });

    const MAX_TOOL_ITERATIONS = 10;
    const deadline = Date.now() + 60_000;
    let iterations = 0;

    while (response.choices[0]?.finish_reason === 'tool_calls') {
      if (++iterations > MAX_TOOL_ITERATIONS) {
        throw new Error(`Tool-use iteration cap (${MAX_TOOL_ITERATIONS}) exceeded`);
      }
      if (Date.now() > deadline) {
        throw new Error('Chat deadline (60s) exceeded');
      }

      const assistantMessage = response.choices[0]?.message;
      const toolCalls = assistantMessage?.tool_calls;
      if (!assistantMessage || !toolCalls?.length) {
        break;
      }

      conversation.push(assistantMessage);

      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function') {
          continue;
        }
        const { name, arguments: argsJson } = toolCall.function;
        let parsedInput: unknown = {};
        try {
          parsedInput = argsJson ? JSON.parse(argsJson) : {};
        } catch {
          conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: Invalid JSON in tool arguments for ${name}`,
          });
          continue;
        }

        try {
          const execOptions = enrichExecutionOptionsWithIdempotency(
            registry,
            name,
            {
              ...options,
              intent: options.intent ?? extractLastUserMessage(messages),
            },
            { toolCallId: toolCall.id },
          );
          const result = await engine.execute(name, parsedInput, execOptions);
          traceIds.push(result.traceId);
          conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result.output),
          });
        } catch (err) {
          conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: serializeToolExecutionError(err),
          });
        }
      }

      response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        tools: tools.length > 0 ? tools : undefined,
        messages: conversation,
      });
    }

    const content = response.choices[0]?.message?.content ?? '';

    return { content, traceIds };
  };

  return { getTools, chat };
};

const extractLastUserMessage = (
  messages: readonly OpenAiChatMessage[],
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message.content;
    }
  }
  return undefined;
};
