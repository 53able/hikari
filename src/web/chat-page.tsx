import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TamaguiProvider, YStack, XStack, Text, Button } from 'tamagui';
import config from './tamagui.config.js';
import { CHAT_MSG_CSS } from './chat-msg-css.js';
import { buildChatClientScript } from './chat-client-script.js';

/** チャット UI のオプション。すべてサーバーサイドの設定値。 */
export interface ChatUiOptions {
  /** ページタイトルとヘッダーに表示するテキスト。デフォルト: `'Hikari Chat'`。 */
  title?: string;
  /** チャット送信先エンドポイント。デフォルト: `'/chat'`。 */
  endpoint?: string;
  /** SSE ストリームエンドポイント。デフォルト: `'/events'`。 */
  eventsEndpoint?: string;
}

interface ChatPageProps {
  title: string;
  endpoint: string;
  eventsEndpoint: string;
}

const ChatPageDocument = ({ title, endpoint, eventsEndpoint }: ChatPageProps): React.ReactElement => (
  <html lang="en">
    <head>
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
    </head>
    <body style={{ margin: 0, height: '100vh' }}>
      <TamaguiProvider config={config} defaultTheme="light">
        <YStack height="100vh" backgroundColor="$background">
          <XStack
            paddingHorizontal="$3"
            paddingVertical="$2"
            backgroundColor="$headerBg"
            alignItems="center"
          >
            <Text color="$headerColor" fontWeight="600" fontSize="$3">
              {title}
            </Text>
          </XStack>
          <YStack id="messages" flex={1} padding="$3" />
          <form
            id="form"
            style={{
              display: 'flex',
              padding: 12,
              gap: 8,
              background: '#fff',
              borderTop: '1px solid #e0e0e0',
              alignItems: 'center',
            }}
          >
            <input
              id="input"
              placeholder="Type a message…"
              autoComplete="off"
              style={{
                flex: 1,
                padding: '8px 12px',
                border: '1px solid #ccc',
                borderRadius: 8,
                fontSize: 14,
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <Button id="send" type="submit" backgroundColor="$headerBg" size="$3">
              <Text color="$headerColor">Send</Text>
            </Button>
          </form>
        </YStack>
      </TamaguiProvider>
      <style dangerouslySetInnerHTML={{ __html: CHAT_MSG_CSS }} />
      <script
        dangerouslySetInnerHTML={{ __html: buildChatClientScript(endpoint, eventsEndpoint) }}
      />
    </body>
  </html>
);

/**
 * Tamagui + React でチャット UI の HTML 文字列を生成する。
 */
export const renderChatPageHtml = (props: ChatPageProps): string =>
  '<!DOCTYPE html>\n' + renderToStaticMarkup(<ChatPageDocument {...props} />);
