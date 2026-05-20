import type { Hono } from 'hono';
import type { ApprovalApi } from '../core/approval-store.js';
import { renderApprovalPageHtml } from '../web/approval-page.js';
import { parseApprovalActionBody, wantsHtmlResponse } from '../web/http-request.js';
import type { HikariHonoEnv } from './hikari-hono-env.js';

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
