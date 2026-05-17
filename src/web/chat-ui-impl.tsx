import { renderChatPageHtml, type ChatUiOptions } from './chat-page.js';

export type { ChatUiOptions };

/**
 * 自己完結型のチャット UI を HTML 文字列としてレンダリングする。
 * 静的シェルは Tamagui（React SSR）、メッセージ領域はインライン script + CSS。
 *
 * @param options - タイトル・エンドポイントなどのカスタマイズ設定。
 */
export const renderChatHtml = (options: ChatUiOptions = {}): string => {
  const title = options.title ?? 'Hikari Chat';
  const endpoint = options.endpoint ?? '/chat';
  const eventsEndpoint = options.eventsEndpoint ?? '/events';
  return renderChatPageHtml({ title, endpoint, eventsEndpoint });
};
