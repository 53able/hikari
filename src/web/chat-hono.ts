import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HttpAdapter } from '../adapters/http.js';
import {
  createHikariExecutionOptionsMiddleware,
  mountHikariApprovals,
  mountHikariCapabilityUi,
  mountHikariChat,
  mountHikariHttpAdapter,
  mountHikariTraceViewer,
  type HikariHonoEnv,
} from '../adapters/hono.js';
import { createHttpAdapter } from '../adapters/http.js';
import { isDevSessionEnabledByEnv } from './dev-session.js';
import type { ChatBackend } from './chat-stream.js';
import type { ChatServerOptions } from './chat-server.js';

/**
 * `createChatServer` と同等のルートを Hono アプリとして組み立てる。
 */
export const createHikariChatApp = (
  backend: ChatBackend,
  options: ChatServerOptions,
): Hono<HikariHonoEnv> => {
  const corsOrigins = options.corsOrigins ?? [];
  const devtools = options.devtools;
  const httpApiBasePath = options.httpApi?.basePath ?? '/api';
  const uiBasePath = options.httpApi?.capabilityResultHtml?.uiBasePath ?? '/capabilities';
  const devSessionEnabled =
    (options.enableDevSession ?? Boolean(devtools)) && isDevSessionEnabledByEnv();

  const httpApi: HttpAdapter | undefined = options.httpApi
    ? createHttpAdapter(options.httpApi.registry, options.httpApi.engine, {
        basePath: options.httpApi.basePath ?? '/api',
        resolveExecutionOptions: options.resolveExecutionOptions,
        corsOrigins,
        rateLimitGuard: options.rateLimitGuard,
        capabilityResultHtml:
          options.httpApi.capabilityResultHtml ??
          (devtools ? { uiBasePath } : undefined),
      })
    : undefined;

  const auth = createHikariExecutionOptionsMiddleware(options.resolveExecutionOptions);
  const app = new Hono<HikariHonoEnv>();

  if (corsOrigins.length > 0) {
    app.use(
      '*',
      cors({
        origin: corsOrigins,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'Idempotency-Key'],
      }),
    );
  }

  app.get('/healthz', (c) => c.json({ ok: true }));

  let routed = app;

  if (httpApi) {
    routed = mountHikariHttpAdapter(routed, httpApi, {
      basePath: options.httpApi?.basePath ?? '/api',
    });
  }

  if (devtools) {
    routed = mountHikariTraceViewer(routed, { storage: devtools.storage });
    routed = mountHikariCapabilityUi(routed, {
      registry: devtools.registry,
      apiBasePath: httpApiBasePath,
      uiBasePath,
      enableDevSession: devSessionEnabled,
    });
  }

  if (options.approvals) {
    routed = mountHikariApprovals(routed, { approvals: options.approvals });
  }

  routed = routed
    .use('/chat', auth)
    .use('/events', auth)
    .use(`${httpApiBasePath}/chat`, auth);

  if (options.approvals) {
    routed = routed.use('/approvals/*', auth);
  }

  return mountHikariChat(routed, {
    backend,
    chatPath: '/chat',
    eventsPath: '/events',
    serveUi: options.serveStaticUi ?? true,
    uiPath: '/',
    sessions: options.sessions,
    rateLimitGuard: options.rateLimitGuard,
    approvals: options.approvals,
  });
};
