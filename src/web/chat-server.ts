import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { renderChatHtml } from './chat-ui.js';
import type { ClaudeAdapter } from '../adapters/claude.js';
import type { HikariAgent } from '../adapters/pi.js';
import type { ExecutionOptions } from '../core/execution.js';
import type { SessionManager } from '../agent/session.js';

/**
 * チャットターン中に `ChatBackend.stream` から emit される SSE イベント。
 * `type` フィールドで判別するユニオン型。
 */
export type ChatStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; name: string; input: unknown; traceId: string }
  | { type: 'tool_result'; traceId: string; output: unknown }
  | { type: 'done'; traceIds: string[] }
  | { type: 'error'; message: string };

/** セッション履歴に保存される単一のチャットメッセージ。 */
export interface ChatMessage {
  /** メッセージのロール。 */
  role: 'user' | 'assistant';
  /** メッセージ本文。 */
  content: string;
  /** 記録された日時。 */
  timestamp: Date;
}

/**
 * ストリーミングチャットバックエンドの抽象インターフェース。
 * 任意の LLM やエージェントをプラグインするために実装する。
 * 組み込みファクトリー: `backendFromClaude`、`backendFromPiAgent`。
 */
export interface ChatBackend {
  /**
   * メッセージと履歴を受け取り、`ChatStreamEvent` の非同期イテラブルを返す。
   * @param message - ユーザーの入力メッセージ。
   * @param history - 現在のセッション履歴。
   * @param options - 呼び出し元の識別情報と権限。
   * @returns `ChatStreamEvent` の非同期イテラブル。`done` または `error` イベントで終端する。
   */
  stream: (
    message: string,
    history: ChatMessage[],
    options: ExecutionOptions,
  ) => AsyncIterable<ChatStreamEvent>;
}

/** `createChatServer` のオプション。 */
export interface ChatServerOptions {
  /** リッスンするポート番号。デフォルト: `3000`。 */
  port?: number;
  /** バインドするホスト。デフォルト: `'127.0.0.1'`。 */
  host?: string;
  /** リクエストから `ExecutionOptions` を解決する関数。省略時は開発用フォールバックが使われる（本番では必ず指定すること）。 */
  resolveExecutionOptions?: (req: IncomingMessage) => ExecutionOptions;
  /** `GET /` でチャット UI HTML を配信するか。デフォルト: `true`。 */
  serveStaticUi?: boolean;
  /** CORS オリジンの許可リスト。 */
  corsOrigins?: string[];
  /** セッション管理に使用する `SessionManager`。省略時はセッション履歴が保持されない。 */
  sessions?: SessionManager;
}

/** `createChatServer` が返すサーバーオブジェクト。 */
export type ChatServer = {
  /** サーバーを起動し、バインドされたポートとホストを返す。 */
  readonly listen: () => Promise<{ port: number; host: string }>;
  /** サーバーを停止する。 */
  readonly close: () => Promise<void>;
  /** Node.js `http` 互換のリクエストハンドラー。既存サーバーへの組み込みに使用する。 */
  readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** 内部の `http.Server` インスタンス。低レベルな操作が必要な場合に使用する。 */
  readonly raw: Server;
};

/**
 * `ClaudeAdapter` を `ChatBackend` としてラップする。
 * 非ストリーミングの `chat()` を呼び出し、全テキストを単一の `text_delta` イベントとして emit する。
 */
export function backendFromClaude(adapter: ClaudeAdapter): ChatBackend {
  return {
    stream(message, history, options) {
      return (async function* () {
        const messages = [
          ...history.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user' as const, content: message },
        ];
        try {
          const result = await adapter.chat(messages, {
            userId: options.userId,
            sessionId: options.sessionId,
            traceId: options.traceId,
            intent: options.intent,
            permissions: options.permissions,
          });
          if (result.content) {
            yield { type: 'text_delta' as const, delta: result.content };
          }
          yield { type: 'done' as const, traceIds: result.traceIds };
        } catch (err) {
          yield { type: 'error' as const, message: err instanceof Error ? err.message : String(err) };
        }
      })();
    },
  };
}

/**
 * Pi `HikariAgent` を `ChatBackend` としてラップする。
 * エージェントの subscribe/prompt イベントモデルを `ChatStreamEvent` の非同期イテラブルにブリッジする。
 */
export function backendFromPiAgent(agent: HikariAgent): ChatBackend {
  return {
    stream(message, _history, _options) {
      return (async function* () {
        const events: ChatStreamEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsub = agent.subscribe((event) => {
          const agentEvent = event as {
            type: string;
            message?: { role?: string; content?: { type: string; text?: string }[] };
            toolName?: string;
            args?: unknown;
            result?: unknown;
            isError?: boolean;
            assistantMessageEvent?: { type: string; delta?: string };
          };

          if (agentEvent.type === 'message_update' && agentEvent.assistantMessageEvent) {
            const ae = agentEvent.assistantMessageEvent;
            if (ae.type === 'text_delta' && ae.delta) {
              events.push({ type: 'text_delta', delta: ae.delta });
            }
          } else if (agentEvent.type === 'tool_execution_start') {
            events.push({
              type: 'tool_use',
              name: agentEvent.toolName ?? '',
              input: agentEvent.args,
              traceId: randomUUID(),
            });
          } else if (agentEvent.type === 'tool_execution_end' && !agentEvent.isError) {
            events.push({
              type: 'tool_result',
              traceId: randomUUID(),
              output: agentEvent.result,
            });
          } else if (agentEvent.type === 'agent_end') {
            events.push({ type: 'done', traceIds: [] });
            done = true;
          }

          resolve?.();
          resolve = null;
        });

        const promptPromise = agent.prompt(message).catch((err: unknown) => {
          events.push({ type: 'error', message: err instanceof Error ? err.message : String(err) });
          done = true;
          resolve?.();
          resolve = null;
        });

        try {
          while (!done || events.length > 0) {
            if (events.length === 0 && !done) {
              await new Promise<void>((r) => { resolve = r; });
            }
            while (events.length > 0) {
              yield events.shift()!;
            }
          }
        } finally {
          unsub();
          await promptPromise;
        }
      })();
    },
  };
}

/**
 * SSE ストリーミング対応の Node.js HTTP チャットサーバーを生成する。
 *
 * ルート:
 * - `GET  /` — チャット UI HTML（`serveStaticUi: true` のとき）
 * - `POST /chat` — ストリーム開始。`{ sessionId, requestId }` を返す
 * - `GET  /events?requestId=...` — 指定リクエストの SSE ストリーム
 * - `GET  /healthz` — ヘルスチェック
 *
 * @param backend - LLM またはエージェントのチャットバックエンド。
 * @param options - ポート・ホスト・認証・CORS・セッション管理などの設定。
 */
export function createChatServer(backend: ChatBackend, options: ChatServerOptions = {}): ChatServer {
  const port = options.port ?? 3000;
  const host = options.host ?? '127.0.0.1';
  const serveUi = options.serveStaticUi ?? true;
  const corsOrigins = options.corsOrigins ?? [];
  const sessionMgr = options.sessions;

  const pendingStreams = new Map<string, AsyncIterator<ChatStreamEvent>>();

  /** DEV-ONLY fallback. Never use in production — trusts a client-controlled header. */
  const defaultResolve: (req: IncomingMessage) => ExecutionOptions = (req) => ({
    userId: (req.headers['x-hikari-user-id'] as string) ?? 'anonymous',
    permissions: [],
    sessionId: undefined,
  });
  const resolveOptions = options.resolveExecutionOptions ?? defaultResolve;

  const setCors = (req: IncomingMessage, res: ServerResponse): void => {
    const origin = req.headers['origin'];
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
  };

  async function readBody(req: IncomingMessage, maxBytes = 512 * 1024): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      let size = 0;
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        size += Buffer.byteLength(chunk);
        if (size > maxBytes) {
          reject(Object.assign(new Error('Request body too large'), { status: 413 }));
          return;
        }
        data += chunk;
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    setCors(req, res);
    const method = req.method ?? 'GET';
    const url = (req.url ?? '/').split('?')[0];
    const query = new URLSearchParams((req.url ?? '').includes('?') ? req.url!.split('?')[1] : '');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === 'GET' && url === '/' && serveUi) {
      const html = renderChatHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (method === 'GET' && url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (method === 'POST' && url === '/chat') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { message: string; sessionId?: string };
        const execOptions = resolveOptions(req);
        const sessionId = body.sessionId ?? sessionMgr?.createSession(execOptions.userId).id;

        const history: ChatMessage[] = sessionId && sessionMgr
          ? (sessionMgr.getMessages(sessionId) as { role: string; content: string; timestamp: Date }[])
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content, timestamp: m.timestamp }))
          : [];

        if (sessionId && sessionMgr) {
          sessionMgr.appendMessage(sessionId, { role: 'user', content: body.message });
        }

        const requestId = randomUUID();
        const iter = backend.stream(body.message, history, {
          ...execOptions,
          sessionId,
        })[Symbol.asyncIterator]();

        pendingStreams.set(requestId, iter);
        setTimeout(() => {
          if (pendingStreams.delete(requestId)) {
            iter.return?.();
          }
        }, 120_000);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId, requestId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (method === 'GET' && url === '/events') {
      const requestId = query.get('requestId');
      if (!requestId) {
        res.writeHead(400);
        res.end('Missing requestId');
        return;
      }
      const iter = pendingStreams.get(requestId);
      if (!iter) {
        res.writeHead(404);
        res.end('Stream not found');
        return;
      }
      pendingStreams.delete(requestId);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const send = (event: ChatStreamEvent): void => {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);

      try {
        let next = await iter.next();
        while (!next.done) {
          send(next.value);
          if (next.value.type === 'done' || next.value.type === 'error') break;
          next = await iter.next();
        }
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        clearInterval(keepAlive);
        res.end();
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      console.error('[ChatServer]', err);
    });
  });

  return {
    handler,
    raw: server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve({ port, host }));
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
