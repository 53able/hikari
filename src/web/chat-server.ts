import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import type { ExecutionOptions } from '../core/execution.js';
import type { SessionManager } from '../agent/session.js';
import type { ApprovalApi } from '../core/approval-store.js';
import type { AuditStorage } from '../core/audit.js';
import type { Engine } from '../core/execution.js';
import type { Registry } from '../core/registry.js';
import type { RateLimitGuard } from '../core/rate-limit.js';
import { createHikariChatApp } from './chat-hono.js';
import type { ChatBackend } from './chat-stream.js';

export type { ChatStreamEvent, ChatMessage, ChatBackend } from './chat-stream.js';
export {
  backendFromClaude,
  backendFromOpenAi,
  backendFromPiAgent,
  type PiChatBackendDeps,
} from './chat-backends.js';

/** `createChatServer` のオプション。 */
export interface ChatServerOptions {
  /** リッスンするポート番号。デフォルト: `3000`。 */
  port?: number;
  /** バインドするホスト。デフォルト: `'127.0.0.1'`。 */
  host?: string;
  /** リクエストから `ExecutionOptions` を解決する関数（必須）。未認証時は 401 を返すこと。 */
  resolveExecutionOptions: (req: Request) => ExecutionOptions | Promise<ExecutionOptions>;
  /** `GET /` でチャット UI HTML を配信するか。デフォルト: `true`。 */
  serveStaticUi?: boolean;
  /** CORS オリジンの許可リスト。 */
  corsOrigins?: string[];
  /** `POST /chat` および REST API で共有するレート制限ガード。 */
  rateLimitGuard?: RateLimitGuard;
  /** セッション管理に使用する `SessionManager`。省略時はセッション履歴が保持されない。 */
  sessions?: SessionManager;
  /** 承認 API。指定時は `/approvals/*` ルートとチャット内 `/approve` `/reject` コマンドが有効になる。 */
  approvals?: ApprovalApi;
  /** 監査トレース一覧・ケイパビリティ探索 HTML（`/traces`, `/capabilities`）。 */
  devtools?: {
    storage: AuditStorage;
    registry: Registry;
  };
  /**
   * 開発用 Cookie セッション UI（`GET/POST /capabilities/dev-session`）。
   * 省略時は `devtools` 有効かつ `HIKARI_DEV_SESSION` が `0` でないとき有効。
   */
  enableDevSession?: boolean;
  /** REST ケイパビリティ API（デフォルトプレフィックス `/api`）。 */
  httpApi?: {
    registry: Registry;
    engine: Engine;
    basePath?: string;
    /** `Accept: text/html` の POST 実行時に結果 HTML を返す。 */
    capabilityResultHtml?: {
      readonly uiBasePath?: string;
    };
  };
}

/** `createChatServer` が返すサーバーオブジェクト。 */
export type ChatServer = {
  readonly listen: () => Promise<{ port: number; host: string }>;
  readonly close: () => Promise<void>;
  readonly app: ReturnType<typeof createHikariChatApp>;
  readonly handler: ReturnType<typeof getRequestListener>;
  readonly raw: Server;
};

/**
 * SSE ストリーミング対応の Node.js HTTP チャットサーバーを生成する。
 * ルート実装は Hono（`createHikariChatApp`）に委譲する thin wrapper。
 */
export const createChatServer = (
  backend: ChatBackend,
  options: ChatServerOptions,
): ChatServer => {
  const port = options.port ?? 3000;
  const host = options.host ?? '127.0.0.1';
  const app = createHikariChatApp(backend, options);
  const listener = getRequestListener(app.fetch);
  const server = createServer(listener);

  return {
    app,
    handler: listener,
    raw: server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve({ port, host }));
      }),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
};
