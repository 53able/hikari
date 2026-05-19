import type { ExecutionOptions } from '../core/execution.js';

/**
 * チャットターン中に `ChatBackend.stream` から emit される SSE イベント。
 */
export type ChatStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; name: string; input: unknown; traceId: string }
  | { type: 'tool_result'; traceId: string; output: unknown }
  | {
      type: 'approval_required';
      requestId: string;
      capabilityName: string;
      riskLevel: string;
      input: unknown;
      traceId: string;
    }
  | { type: 'done'; traceIds: string[] }
  | { type: 'error'; message: string };

/** セッション履歴に保存される単一のチャットメッセージ。 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/**
 * ストリーミングチャットバックエンドの抽象インターフェース。
 */
export interface ChatBackend {
  stream: (
    message: string,
    history: ChatMessage[],
    options: ExecutionOptions,
  ) => AsyncIterable<ChatStreamEvent>;
}
