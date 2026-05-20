import type { SessionMessage } from './session.js';
import type { ChatMessage } from '../web/chat-stream.js';

/** `buildLlmChatHistory` のオプション。 */
export type LlmContextOptions = {
  /** LLM に渡す最大メッセージ数（古いものから削除）。デフォルト: 40。 */
  maxMessages?: number;
  /** 1 メッセージあたりの最大文字数。超過分は末尾を省略。デフォルト: 8000。 */
  maxCharsPerMessage?: number;
};

const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_MAX_CHARS = 8000;

const truncateContent = (content: string, maxChars: number): string =>
  content.length <= maxChars ? content : `${content.slice(0, maxChars)}…`;

const toChatMessage = (
  message: SessionMessage | ChatMessage,
  maxChars: number,
): ChatMessage => ({
  role: message.role === 'assistant' ? 'assistant' : 'user',
  content: truncateContent(message.content, maxChars),
  timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp),
});

/**
 * セッション履歴を LLM 向けに件数・文字数で切り詰める。
 * `SessionManager` の保持上限とは別レイヤのコンテキスト制御。
 */
export const buildLlmChatHistory = (
  messages: readonly (SessionMessage | ChatMessage)[],
  options: LlmContextOptions = {},
): ChatMessage[] => {
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxChars = options.maxCharsPerMessage ?? DEFAULT_MAX_CHARS;
  const recent = messages.slice(-maxMessages);
  return recent.map((message) => toChatMessage(message, maxChars));
};
