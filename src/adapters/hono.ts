import type { HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import type { Env, Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import type { ApprovalApi } from '../core/approval-store.js';
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

type HonoWithNodeBindings = {
  readonly Bindings: HttpBindings;
};

/** Hono `Variables` に載せる Hikari 実行コンテキスト。 */
export type HikariHonoVariables = {
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly executionOptions: NormalizedExecutionOptions;
};

/** `@hono/node-server` + Hikari 実行コンテキスト用 Env。 */
export type HikariHonoEnv = {
  readonly Bindings: HttpBindings;
  readonly Variables: HikariHonoVariables;
};

/**
 * リクエストから `ExecutionOptions` を解決し Hono `Variables` に載せるミドルウェア。
 * `createChatServer` と同様に HTTP アダプタ・チャット・承認ルートで共有する。
 */
export const createHikariExecutionOptionsMiddleware = (
  resolveExecutionOptions: (
    req: IncomingMessage,
  ) => ExecutionOptions | Promise<ExecutionOptions>,
): MiddlewareHandler<HikariHonoEnv> =>
  async (c, next) => {
    const exec = normalizeExecutionOptions(
      await Promise.resolve(resolveExecutionOptions(c.env.incoming)),
    );
    c.set('userId', exec.userId);
    c.set('permissions', exec.permissions);
    c.set('executionOptions', exec);
    await next();
  };

/**
 * `createHttpAdapter` を Hono ミドルウェアとして実行する。
 * `@hono/node-server` の `HttpBindings`（`c.env.incoming` / `c.env.outgoing`）が必要。
 */
export const createHikariHttpMiddleware = (
  httpAdapter: HttpAdapter,
): MiddlewareHandler<HonoWithNodeBindings> =>
  async (c) => {
    const handled = await httpAdapter.handler(c.env.incoming, c.env.outgoing);
    if (handled) {
      return RESPONSE_ALREADY_SENT;
    }
    return c.notFound();
  };

/**
 * Hono アプリに Hikari REST ルートを登録する。
 *
 * 登録されるルート:
 * - `{basePath}/capabilities`
 * - `{basePath}/capabilities/*`
 * - `{basePath}/openapi.json`
 */
export const mountHikariHttpAdapter = <E extends HonoWithNodeBindings>(
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
 *
 * 登録されるルート:
 * - `GET {uiBasePath}` — Capability Explorer HTML
 * - `GET {uiBasePath}/:name/form` — 入力フォーム HTML
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

const readNodeBody = async (
  req: IncomingMessage,
  maxBytes = 512 * 1024,
): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

/**
 * 承認キュー UI / API を Hono にマウントする（`createChatServer` の `/approvals` 相当）。
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
        const raw = await readNodeBody(c.env.incoming);
        const body = raw
          ? parseApprovalActionBody(
              raw,
              c.env.incoming.headers['content-type'] as string | undefined,
            )
          : {};
        const exec = c.get('executionOptions');
        const actor = body.by ?? exec.userId;
        const ok = await Promise.resolve(
          action === 'approve'
            ? options.approvals.approve(id, actor)
            : options.approvals.reject(id, actor, body.reason),
        );
        if (wantsHtmlResponse(c.env.incoming)) {
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
});

/** `mountHikariChat` のオプション。 */
export type MountHikariChatOptions = {
  readonly llmChat: LlmChatClient | undefined;
  readonly chatPath?: string;
  readonly uiPath?: string;
  /** Tamagui チャットシェル（`GET /`）。ストリーミング SSE は `createChatServer` を利用すること。 */
  readonly serveUi?: boolean;
  readonly missingApiKeyMessage?: string;
};

/**
 * 非ストリーミング JSON チャット API を Hono にマウントする。
 * `createHikariExecutionOptionsMiddleware` を同じプレフィックスに適用すること。
 */
export const mountHikariChat = <E extends HikariHonoEnv>(
  app: Hono<E>,
  options: MountHikariChatOptions,
): Hono<E> => {
  const chatPath = options.chatPath ?? '/api/chat';
  const uiPath = options.uiPath ?? '/';
  const missingMessage = options.missingApiKeyMessage ?? missingLlmApiKeyMessage;
  let result = app;
  if (options.serveUi !== false) {
    result = result.get(uiPath, (c) =>
      c.html(
        renderChatHtml({
          title: 'Hikari Chat',
          endpoint: chatPath,
          eventsEndpoint: '/events',
        }),
      ),
    );
  }
  return result.post(chatPath, async (c) => {
    const parsed = chatBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body' } }, 400);
    }
    if (!options.llmChat) {
      return c.json(
        { error: { code: 'MISSING_API_KEY', message: missingMessage } },
        503,
      );
    }
    const exec = c.get('executionOptions');
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
};
