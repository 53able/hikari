import type { Env, Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { Registry } from '../core/registry.js';
import {
  createCapabilityUiHandlers,
  type CapabilityUiPathOptions,
} from '../web/capability-ui.js';
import {
  devSessionCookieOptions,
  HIKARI_PERMISSIONS_COOKIE,
  HIKARI_USER_ID_COOKIE,
  parseDevSessionFormBody,
} from '../web/dev-session.js';
import { createTraceViewer } from '../devtools/trace-viewer.js';
import type { AuditStorage } from '../core/audit.js';

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
