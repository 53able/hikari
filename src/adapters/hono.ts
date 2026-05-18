import type { Env, Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import type { ApprovalApi } from '../core/approval-store.js';
import type { ApprovalRequest } from '../core/approval.js';
import type { RateLimitGuard } from '../core/rate-limit.js';
import { clientIpFromRequest } from '../core/rate-limit.js';
import type { SessionManager } from '../agent/session.js';
import type { ChatBackend, ChatMessage, ChatStreamEvent } from '../web/chat-stream.js';
import type { AuditStorage } from '../core/audit.js';
import {
  normalizeExecutionOptions,
  type ExecutionOptions,
  type NormalizedExecutionOptions,
} from '../core/execution.js';
import type { Registry } from '../core/registry.js';
import { createTraceViewer } from '../devtools/trace-viewer.js';
import type { LlmChatClient } from './llm-provider.js';
import type { HttpAdapter } from './http.js';
import {
  createCapabilityUiHandlers,
  type CapabilityUiPathOptions,
} from '../web/capability-ui.js';
import { renderApprovalPageHtml } from '../web/approval-page.js';
import {
  devSessionCookieOptions,
  HIKARI_PERMISSIONS_COOKIE,
  HIKARI_USER_ID_COOKIE,
  parseDevSessionFormBody,
} from '../web/dev-session.js';
import { parseApprovalActionBody, wantsHtmlResponse } from '../web/http-request.js';
import { renderChatHtml } from '../web/chat-ui.js';
import { missingLlmApiKeyMessage } from './llm-provider.js';

/** `mountHikariHttpAdapter` のオプション。 */
export type MountHikariHttpAdapterOptions = {
  /** HTTP アダプタのベースパス（`createHttpAdapter` の `basePath` と一致させる）。デフォルト: `/api`。 */
  readonly basePath?: string;
};

/** Hono `Variables` に載せる Hikari 実行コンテキスト。 */
export type HikariHonoVariables = {
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly executionOptions: NormalizedExecutionOptions;
};

/** Hikari 実行コンテキスト用 Env。 */
export type HikariHonoEnv = {
  readonly Variables: HikariHonoVariables;
};

/**
 * リクエストから `ExecutionOptions` を解決し Hono `Variables` に載せるミドルウェア。
 */
export const createHikariExecutionOptionsMiddleware = (
  resolveExecutionOptions: (
    req: Request,
  ) => ExecutionOptions | Promise<ExecutionOptions>,
): MiddlewareHandler<HikariHonoEnv> =>
  async (c, next) => {
    const exec = normalizeExecutionOptions(
      await Promise.resolve(resolveExecutionOptions(c.req.raw)),
    );
    c.set('userId', exec.userId);
    c.set('permissions', exec.permissions);
    c.set('executionOptions', exec);
    await next();
  };

/**
 * `createHttpAdapter` を Hono ルートとしてマウントする。
 */
export const createHikariHttpMiddleware = (
  httpAdapter: HttpAdapter,
): MiddlewareHandler =>
  async (c) => {
    const response = await httpAdapter.fetch(c.req.raw);
    if (response) {
      return response;
    }
    return c.notFound();
  };

/**
 * Hono アプリに Hikari REST ルートを登録する。
 */
export const mountHikariHttpAdapter = <E extends Env = Env>(
  app: Hono<E>,
  httpAdapter: HttpAdapter,
  options: MountHikariHttpAdapterOptions = {},
): Hono<E> => {
  const basePath = options.basePath ?? '/api';
  const middleware = createHikariHttpMiddleware(httpAdapter);
  return app
    .all(`${basePath}/capabilities`, middleware)
    .all(`${basePath}/capabilities/*`, middleware)
    .all(`${basePath}/openapi.json`, middleware);
};

/** `mountHikariCapabilityUi` のオプション。 */
export type MountHikariCapabilityUiOptions = CapabilityUiPathOptions & {
  readonly registry: Registry;
};

/**
 * Hono アプリにケイパビリティ投影 UI（一覧・入力フォーム）を登録する。
 */
export const mountHikariCapabilityUi = <E extends Env = Env>(
  app: Hono<E>,
  options: MountHikariCapabilityUiOptions,
): Hono<E> => {
  const ui = createCapabilityUiHandlers(options.registry, options);
  const uiBasePath = ui.paths.uiBasePath;
  const devSessionPath = ui.devSessionPath;
  let result = app.get(uiBasePath, (c) => c.html(ui.listHtml()));
  if (devSessionPath) {
    result = result
      .get(devSessionPath, (c) => {
        const html = ui.devSessionHtml();
        return html ? c.html(html) : c.notFound();
      })
      .post(devSessionPath, async (c) => {
        const body = await c.req.parseBody();
        const rawUserId = typeof body.userId === 'string' ? body.userId : '';
        const rawPermissions = typeof body.permissions === 'string' ? body.permissions : '';
        const parsed = parseDevSessionFormBody(
          new URLSearchParams({ userId: rawUserId, permissions: rawPermissions }).toString(),
          'application/x-www-form-urlencoded',
        );
        if ('error' in parsed) {
          return c.json({ error: parsed.error }, 400);
        }
        setCookie(c, HIKARI_USER_ID_COOKIE, parsed.userId, devSessionCookieOptions);
        setCookie(c, HIKARI_PERMISSIONS_COOKIE, parsed.permissions, devSessionCookieOptions);
        return c.redirect(uiBasePath, 303);
      });
  }
  return result.get(`${uiBasePath}/:name/form`, (c) => {
    const name = c.req.param('name');
    const html = ui.formHtml(name);
    if (!html) {
      return c.json({ error: `Capability not found: ${name}` }, 404);
    }
    return c.html(html);
  });
};

/** `mountHikariTraceViewer` のオプション。 */
export type MountHikariTraceViewerOptions = {
  readonly storage: AuditStorage;
  readonly tracesPath?: string;
};

/**
 * 監査トレース HTML（`GET /traces`）を Hono にマウントする。
 */
export const mountHikariTraceViewer = <E extends Env = Env>(
  app: Hono<E>,
  options: MountHikariTraceViewerOptions,
): Hono<E> => {
  const tracesPath = options.tracesPath ?? '/traces';
  const viewer = createTraceViewer(options.storage);
  return app.get(tracesPath, async (c) => {
    const spans = await viewer.listTraces();
    return c.html(viewer.renderHtml(spans));
  });
};

/** `mountHikariApprovals` のオプション。 */
export type MountHikariApprovalsOptions = {
  readonly approvals: ApprovalApi;
  readonly basePath?: string;
};

/**
 * 承認キュー UI / API を Hono にマウントする。
 */
export const mountHikariApprovals = <E extends HikariHonoEnv>(
  app: Hono<E>,
  options: MountHikariApprovalsOptions,
): Hono<E> => {
  const base = options.basePath ?? '/approvals';
  return app
    .get(base, async (c) => {
      const pending = await Promise.resolve(options.approvals.listPending());
      return c.html(renderApprovalPageHtml(pending));
    })
    .get(`${base}/pending`, async (c) => {
      const pending = await Promise.resolve(options.approvals.listPending());
      return c.json({ pending });
    })
    .post(`${base}/:id/:action`, async (c) => {
      const id = c.req.param('id');
      const action = c.req.param('action');
      if (action !== 'approve' && action !== 'reject') {
        return c.json({ error: 'Use POST /approvals/:id/approve or /reject' }, 400);
      }
      try {
        const raw = await c.req.text();
        const body = raw
          ? parseApprovalActionBody(raw, c.req.header('content-type'))
          : {};
        const exec = c.get('executionOptions');
        const actor = body.by ?? exec.userId;
        const ok = await Promise.resolve(
          action === 'approve'
            ? options.approvals.approve(id, actor)
            : options.approvals.reject(id, actor, body.reason),
        );
        if (wantsHtmlResponse(c.req.raw)) {
          return c.redirect(ok ? base : `${base}?error=not_found`, 303);
        }
        return c.json({ ok, id, action }, ok ? 200 : 404);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 400);
      }
    });
};

const chatBodySchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
});

type PendingChatStream = {
  readonly iter: AsyncIterator<ChatStreamEvent>;
  readonly sessionId?: string;
};

const wantsSseStream = (req: Request): boolean => {
  const accept = req.headers.get('accept') ?? '';
  return accept.includes('text/event-stream');
};

/** `mountHikariChat` のオプション。 */
export type MountHikariChatOptions = {
  /** ストリーミング対応チャットバックエンド（Pi / Claude / OpenAI ラップ）。 */
  readonly backend?: ChatBackend;
  /** 非ストリーミング JSON チャット（`backend` 未指定時）。 */
  readonly llmChat?: LlmChatClient | undefined;
  readonly chatPath?: string;
  readonly eventsPath?: string;
  readonly uiPath?: string;
  readonly serveUi?: boolean;
  readonly missingApiKeyMessage?: string;
  readonly sessions?: SessionManager;
  readonly rateLimitGuard?: RateLimitGuard;
  readonly approvals?: ApprovalApi;
  readonly onRegisterApprovalNotifier?: (
    traceId: string,
    notify: (req: ApprovalRequest) => void,
  ) => (() => void) | void;
};

/**
 * チャット UI・JSON API・SSE ストリームを Hono にマウントする。
 * `createHikariExecutionOptionsMiddleware` をチャットルートに適用すること。
 */
export const mountHikariChat = <E extends HikariHonoEnv>(
  app: Hono<E>,
  options: MountHikariChatOptions,
): Hono<E> => {
  const chatPath = options.chatPath ?? '/api/chat';
  const eventsPath = options.eventsPath ?? '/events';
  const uiPath = options.uiPath ?? '/';
  const missingMessage = options.missingApiKeyMessage ?? missingLlmApiKeyMessage;
  const pendingStreams = new Map<string, PendingChatStream>();
  const sessionMgr = options.sessions;
  const approvals = options.approvals;

  let result = app;
  if (options.serveUi !== false) {
    result = result.get(uiPath, (c) =>
      c.html(
        renderChatHtml({
          title: 'Hikari Chat',
          endpoint: chatPath,
          eventsEndpoint: eventsPath,
        }),
      ),
    );
  }

  result.post(chatPath, async (c) => {
    const parsed = chatBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body' } }, 400);
    }

    const exec = c.get('executionOptions');

    if (options.rateLimitGuard) {
      const limited = await Promise.resolve(
        options.rateLimitGuard.check({
          ip: clientIpFromRequest(c.req.raw),
          userId: exec.userId,
        }),
      );
      if (!limited.allowed) {
        return c.json(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests',
              retryAfterSeconds: limited.retryAfterSeconds,
            },
          },
          429,
          { 'Retry-After': String(limited.retryAfterSeconds) },
        );
      }
    }

    const approveMatch = parsed.data.message.match(/^\/approve\s+(\S+)\s*$/i);
    const rejectMatch = parsed.data.message.match(/^\/reject\s+(\S+)(?:\s+(.+))?$/i);
    if (approvals && approveMatch) {
      const id = approveMatch[1];
      const ok = await Promise.resolve(approvals.approve(id, exec.userId));
      return c.json({ ok, id, action: 'approve' });
    }
    if (approvals && rejectMatch) {
      const id = rejectMatch[1];
      const reason = rejectMatch[2]?.trim();
      const ok = await Promise.resolve(approvals.reject(id, exec.userId, reason));
      return c.json({ ok, id, action: 'reject', reason });
    }

    if (options.backend) {
      const sessionId = parsed.data.sessionId ?? sessionMgr?.createSession(exec.userId).id;
      const history: ChatMessage[] =
        sessionId && sessionMgr
          ? (sessionMgr.getMessages(sessionId) as {
              role: string;
              content: string;
              timestamp: Date;
            }[])
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
                timestamp: m.timestamp,
              }))
          : [];

      if (sessionId && sessionMgr) {
        sessionMgr.appendMessage(sessionId, { role: 'user', content: parsed.data.message });
      }

      const streamOptions = { ...exec, sessionId };

      if (wantsSseStream(c.req.raw)) {
        return streamSSE(c, async (stream) => {
          let assistantText = '';
          for await (const event of options.backend!.stream(
            parsed.data.message,
            history,
            streamOptions,
          )) {
            if (event.type === 'text_delta') {
              assistantText += event.delta;
            }
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
            });
            if (event.type === 'done' && sessionId && sessionMgr) {
              sessionMgr.appendMessage(sessionId, {
                role: 'assistant',
                content: assistantText.trim() || '(completed)',
                traceIds: event.traceIds,
              });
              break;
            }
            if (event.type === 'error') {
              break;
            }
          }
        });
      }

      const requestId = randomUUID();
      const iter = options.backend.stream(
        parsed.data.message,
        history,
        streamOptions,
      )[Symbol.asyncIterator]();
      pendingStreams.set(requestId, { iter, sessionId });
      setTimeout(() => {
        const pending = pendingStreams.get(requestId);
        if (pending) {
          pendingStreams.delete(requestId);
          pending.iter.return?.();
        }
      }, 120_000);
      return c.json({ sessionId, requestId });
    }

    if (!options.llmChat) {
      return c.json(
        { error: { code: 'MISSING_API_KEY', message: missingMessage } },
        503,
      );
    }
    const chatResult = await options.llmChat.chat(
      [{ role: 'user', content: parsed.data.message }],
      {
        ...exec,
        intent: 'Hikari chat',
      },
    );
    return c.json({
      content: chatResult.content,
      traceIds: chatResult.traceIds,
      provider: options.llmChat.provider,
    });
  });

  result.get(eventsPath, async (c) => {
    const requestId = c.req.query('requestId');
    if (!requestId) {
      return c.text('Missing requestId', 400);
    }
    const pending = pendingStreams.get(requestId);
    if (!pending) {
      return c.text('Stream not found', 404);
    }
    pendingStreams.delete(requestId);
    const { iter, sessionId } = pending;

    return streamSSE(c, async (stream) => {
      let assistantText = '';
      try {
        let next = await iter.next();
        while (!next.done) {
          const event = next.value;
          if (event.type === 'text_delta') {
            assistantText += event.delta;
          }
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
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
          if (event.type === 'error') {
            break;
          }
          next = await iter.next();
        }
      } catch (err) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          }),
        });
      }
    });
  });

  return result;
};
