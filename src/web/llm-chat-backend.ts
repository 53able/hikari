import { buildLlmChatHistory } from '../agent/context.js';
import type { ExecutionOptions } from '../core/execution.js';
import type { ChatBackend, ChatStreamEvent } from './chat-stream.js';

/** 非ストリーミング LLM チャット関数の共通シグネチャ。 */
export type LlmChatFn = (
  messages: readonly { role: 'user' | 'assistant'; content: string }[],
  options: ExecutionOptions,
) => Promise<{ content: string; traceIds: string[] }>;

/**
 * 非ストリーミング `chat()` を `ChatBackend` にラップする。
 * Claude / OpenAI アダプタで共有する。
 */
export const createLlmChatBackend = (chat: LlmChatFn): ChatBackend => ({
  stream(message, history, options) {
    return (async function* (): AsyncGenerator<ChatStreamEvent> {
      const trimmed = buildLlmChatHistory(history);
      const messages = [
        ...trimmed.map((entry) => ({
          role: entry.role as 'user' | 'assistant',
          content: entry.content,
        })),
        { role: 'user' as const, content: message },
      ];
      try {
        const result = await chat(messages, options);
        if (result.content) {
          yield { type: 'text_delta' as const, delta: result.content };
        }
        yield { type: 'done' as const, traceIds: result.traceIds };
      } catch (err) {
        yield {
          type: 'error' as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    })();
  },
});
