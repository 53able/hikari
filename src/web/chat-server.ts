import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { renderChatHtml } from './chat-ui.js';
import type { ClaudeAdapter } from '../adapters/claude.js';
import type { OpenAiAdapter } from '../adapters/openai.js';
import type { OpenAiChatMessage } from '../adapters/openai.js';
import {
  createHikariAgent,
  chatHistoryToAgentMessages,
  intentSnippetFromMessage,
  traceIdFromPiToolResult,
  type HikariAgentOptions,
} from '../adapters/pi.js';
import type { Engine } from '../core/execution.js';
import type { HarnessTracer } from '../core/harness-trace.js';
import type { Registry } from '../core/registry.js';
import type { ExecutionOptions } from '../core/execution.js';
import type { SessionManager } from '../agent/session.js';
import type { ApprovalApi } from '../core/approval-store.js';
import type { ApprovalRequest } from '../core/approval.js';
import type { AuditStorage } from '../core/audit.js';
import { buildHarnessPlan } from '../core/harness-plan.js';
import { createHttpAdapter, type HttpAdapter } from '../adapters/http.js';
import { createTraceViewer } from '../devtools/trace-viewer.js';
import { renderApprovalPageHtml } from './approval-page.js';
import { createCapabilityUiHandlers } from './capability-ui.js';
import type { RateLimitGuard } from '../core/rate-limit.js';
import { clientIpFromRequest } from '../core/rate-limit.js';
import {
  isDevSessionEnabledByEnv,
  parseDevSessionFormBody,
  redirectWithDevSessionCookies,
} from './dev-session.js';
import { parseApprovalActionBody, wantsHtmlResponse } from './http-request.js';

/**
 * チャットターン中に `ChatBackend.stream` から emit される SSE イベント。
 * `type` フィールドで判別するユニオン型。
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
 * 組み込みファクトリー: `backendFromClaude`、`backendFromOpenAi`、`backendFromPiAgent`。
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
 * `OpenAiAdapter` を `ChatBackend` としてラップする。
 * 非ストリーミングの `chat()` を呼び出し、全テキストを単一の `text_delta` イベントとして emit する。
 */
export const backendFromOpenAi = (adapter: OpenAiAdapter): ChatBackend => ({
  stream(message, history, options) {
    return (async function* () {
      const messages: OpenAiChatMessage[] = [
        ...history.map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
        { role: 'user', content: message },
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
        yield {
          type: 'error' as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    })();
  },
});

/** `backendFromPiAgent` の依存関係。リクエストごとに Agent を生成しコンテキスト漏洩を防ぐ。 */
export interface PiChatBackendDeps {
  registry: Registry;
  engine: Engine;
  harness?: HarnessTracer;
  agentOptions?: HikariAgentOptions;
  /**
   * ストリーム単位で承認待ち通知を登録する。
   * @returns ストリーム終了時に呼ぶ解除関数。
   */
  onRegisterApprovalNotifier?: (
    traceId: string,
    notify: (req: ApprovalRequest) => void,
  ) => (() => void) | void;
}

/**
 * Pi harness + Hikari エンジンから `ChatBackend` を生成する。
 * 各ストリームで専用 Agent を起動し、履歴・`ExecutionOptions`・harness trace をターン単位で適用する。
 */
export function backendFromPiAgent(deps: PiChatBackendDeps): ChatBackend {
  return {
    stream(message, history, options) {
      return (async function* () {
        const traceId = options.traceId ?? randomUUID();
        const intent = options.intent ?? intentSnippetFromMessage(message);
        let unregisterApproval: (() => void) | undefined;
        const executionContext = {
          userId: options.userId,
          sessionId: options.sessionId,
          traceId,
          intent,
          permissions: options.permissions,
        };

        await deps.harness?.recordIntent({
          traceId,
          userId: options.userId,
          sessionId: options.sessionId,
          intent,
        });
        await deps.harness?.recordPlan({
          traceId,
          userId: options.userId,
          sessionId: options.sessionId,
          intent,
          plan: buildHarnessPlan(deps.registry),
        });

        const contextRef = { current: executionContext };
        const agent = createHikariAgent(
          deps.registry,
          deps.engine,
          () => contextRef.current,
          { harness: deps.harness, ...deps.agentOptions },
        );

        agent.state.messages = chatHistoryToAgentMessages(history, agent.state.model);

        const events: ChatStreamEvent[] = [];
        const traceIds = new Set<string>([traceId]);
        let resolve: (() => void) | null = null;
        let done = false;

        unregisterApproval = deps.onRegisterApprovalNotifier?.(traceId, (req) => {
          events.push({
            type: 'approval_required',
            requestId: req.id,
            capabilityName: req.capabilityName,
            riskLevel: req.riskLevel,
            input: req.input,
            traceId: req.context.traceId,
          });
          resolve?.();
          resolve = null;
        }) ?? undefined;

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
              traceId,
            });
          } else if (agentEvent.type === 'tool_execution_end') {
            const toolTraceId = traceIdFromPiToolResult(agentEvent.result) ?? traceId;
            traceIds.add(toolTraceId);
            events.push({
              type: 'tool_result',
              traceId: toolTraceId,
              output: agentEvent.isError
                ? { error: agentEvent.result }
                : agentEvent.result,
            });
          } else if (agentEvent.type === 'agent_end') {
            events.push({ type: 'done', traceIds: [...traceIds] });
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
          unregisterApproval?.();
          unsub();
          agent.reset();
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
 * - `GET  /traces` — 監査トレース HTML（`devtools` 指定時）
 * - `GET  /capabilities` — ケイパビリティ探索 HTML（`devtools` 指定時）
 * - `GET/POST /capabilities/dev-session` — 開発用 Cookie セッション（`enableDevSession` 時）
 * - `GET  /capabilities/:name/form` — ケイパビリティ入力フォーム HTML（`devtools` 指定時）
 * - `{httpApi.basePath}/*` — REST ケイパビリティ API（`httpApi` 指定時）
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
  const approvals = options.approvals;
  const devtools = options.devtools;
  const traceViewer = devtools ? createTraceViewer(devtools.storage) : undefined;
  const httpApiBasePath = options.httpApi?.basePath ?? '/api';
  const uiBasePath = options.httpApi?.capabilityResultHtml?.uiBasePath ?? '/capabilities';
  const devSessionEnabled =
    (options.enableDevSession ?? Boolean(devtools)) && isDevSessionEnabledByEnv();
  const capabilityUi = devtools
    ? createCapabilityUiHandlers(devtools.registry, {
        apiBasePath: httpApiBasePath,
        uiBasePath,
        enableDevSession: devSessionEnabled,
      })
    : undefined;

  /** DEV-ONLY fallback. Never use in production — trusts a client-controlled header. */
  const defaultResolve: (req: IncomingMessage) => ExecutionOptions = (req) => ({
    userId: (req.headers['x-hikari-user-id'] as string) ?? 'anonymous',
    permissions: [],
    sessionId: undefined,
  });
  const resolveOptions = options.resolveExecutionOptions ?? defaultResolve;
  const rateLimitGuard = options.rateLimitGuard;

  const httpApi: HttpAdapter | undefined = options.httpApi
    ? createHttpAdapter(options.httpApi.registry, options.httpApi.engine, {
        basePath: options.httpApi.basePath ?? '/api',
        resolveExecutionOptions: resolveOptions,
        corsOrigins,
        rateLimitGuard,
        capabilityResultHtml:
          options.httpApi.capabilityResultHtml ??
          (devtools ? { uiBasePath } : undefined),
      })
    : undefined;

  type PendingStream = {
    iter: AsyncIterator<ChatStreamEvent>;
    sessionId?: string;
  };

  const pendingStreams = new Map<string, PendingStream>();

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

    if (httpApi && (await httpApi.handler(req, res))) {
      return;
    }

    if (method === 'GET' && url === '/traces' && traceViewer) {
      const spans = await traceViewer.listTraces();
      const html = traceViewer.renderHtml(spans);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (method === 'GET' && capabilityUi?.matchesListPath(url)) {
      const html = capabilityUi.listHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (method === 'GET' && capabilityUi?.matchesDevSessionPath(url)) {
      const html = capabilityUi.devSessionHtml();
      if (!html) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Dev session disabled' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (method === 'POST' && capabilityUi?.matchesDevSessionPath(url)) {
      try {
        const raw = await readBody(req);
        const parsed = parseDevSessionFormBody(
          raw,
          req.headers['content-type'] as string | undefined,
        );
        if ('error' in parsed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: parsed.error }));
          return;
        }
        redirectWithDevSessionCookies(
          res,
          capabilityUi.paths.uiBasePath,
          parsed.userId,
          parsed.permissions,
        );
      } catch (err) {
        const status = (err as { status?: number }).status ?? 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      return;
    }

    if (method === 'GET' && capabilityUi) {
      const formName = capabilityUi.matchesFormPath(url);
      if (formName) {
        const html = capabilityUi.formHtml(formName);
        if (!html) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Capability not found: ${formName}` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
    }

    if (method === 'GET' && url === '/approvals' && approvals) {
      const pending = await Promise.resolve(approvals.listPending());
      const html = renderApprovalPageHtml(pending);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (method === 'GET' && url === '/approvals/pending' && approvals) {
      const pending = await Promise.resolve(approvals.listPending());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pending }));
      return;
    }

    if (method === 'POST' && url.startsWith('/approvals/') && approvals) {
      const parts = url.split('/').filter(Boolean);
      const id = parts[1];
      const action = parts[2];
      if (!id || (action !== 'approve' && action !== 'reject')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Use POST /approvals/:id/approve or /reject' }));
        return;
      }
      try {
        const raw = await readBody(req);
        const body = raw
          ? parseApprovalActionBody(raw, req.headers['content-type'] as string | undefined)
          : {};
        const execOptions = resolveOptions(req);
        const actor = body.by ?? execOptions.userId;
        const ok = await Promise.resolve(
          action === 'approve'
            ? approvals.approve(id, actor)
            : approvals.reject(id, actor, body.reason),
        );
        if (wantsHtmlResponse(req)) {
          res.writeHead(ok ? 303 : 404, { Location: '/approvals' });
          res.end();
          return;
        }
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok, id, action }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (method === 'POST' && url === '/chat') {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { message: string; sessionId?: string };
        const execOptions = resolveOptions(req);

        if (rateLimitGuard) {
          const limited = await Promise.resolve(
            rateLimitGuard.check({
              ip: clientIpFromRequest(req),
              userId: execOptions.userId,
            }),
          );
          if (!limited.allowed) {
            res.writeHead(429, {
              'Content-Type': 'application/json',
              'Retry-After': String(limited.retryAfterSeconds),
            });
            res.end(
              JSON.stringify({
                error: {
                  code: 'RATE_LIMITED',
                  message: 'Too many requests',
                  retryAfterSeconds: limited.retryAfterSeconds,
                },
              }),
            );
            return;
          }
        }

        const approveMatch = body.message.match(/^\/approve\s+(\S+)\s*$/i);
        const rejectMatch = body.message.match(/^\/reject\s+(\S+)(?:\s+(.+))?$/i);
        if (approvals && approveMatch) {
          const id = approveMatch[1];
          const ok = await Promise.resolve(approvals.approve(id, execOptions.userId));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok, id, action: 'approve' }));
          return;
        }
        if (approvals && rejectMatch) {
          const id = rejectMatch[1];
          const reason = rejectMatch[2]?.trim();
          const ok = await Promise.resolve(approvals.reject(id, execOptions.userId, reason));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok, id, action: 'reject', reason }));
          return;
        }

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

        pendingStreams.set(requestId, { iter, sessionId });
        setTimeout(() => {
          const pending = pendingStreams.get(requestId);
          if (pending) {
            pendingStreams.delete(requestId);
            pending.iter.return?.();
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
      const pending = pendingStreams.get(requestId);
      if (!pending) {
        res.writeHead(404);
        res.end('Stream not found');
        return;
      }
      pendingStreams.delete(requestId);
      const { iter, sessionId } = pending;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const send = (event: ChatStreamEvent): void => {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
      let assistantText = '';

      try {
        let next = await iter.next();
        while (!next.done) {
          const event = next.value;
          if (event.type === 'text_delta') {
            assistantText += event.delta;
          }
          send(event);
          if (event.type === 'done') {
            if (sessionId && sessionMgr) {
              sessionMgr.appendMessage(sessionId, {
                role: 'assistant',
                content: assistantText.trim() || '(completed)',
                traceIds: event.traceIds,
              });
            }
            break;
          }
          if (event.type === 'error') break;
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
