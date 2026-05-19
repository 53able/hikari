import { Hono } from 'hono';
import {
  createHttpAdapter,
  createHeaderExecutionOptionsResolver,
  missingLlmApiKeyMessage,
  resolveLlmFromEnv,
} from '../../src/index.js';
import {
  createHikariExecutionOptionsMiddleware,
  mountHikariHttpAdapter,
  mountHikariCapabilityUi,
  mountHikariChat,
  mountHikariTraceViewer,
  mountHikariApprovals,
  type HikariHonoEnv,
} from '../../src/hono.js';
import type { ApprovalApi } from '../../src/core/approval-store.js';
import type { AuditStorage } from '../../src/core/audit.js';
import type { Engine } from '../../src/core/execution.js';
import type { Registry } from '../../src/core/registry.js';

const HIKARI_BASE_PATH = '/api';
const CAPABILITY_UI_PATH = '/capabilities';

const resolveExecutionOptions = createHeaderExecutionOptionsResolver({
  readCookies: true,
});

/** Hono アプリに渡す Hikari ランタイム。 */
export type HonoBookstoreOptions = {
  readonly registry: Registry;
  readonly engine: Engine;
  readonly auditStorage: AuditStorage;
  readonly approvalApi: ApprovalApi;
};

/**
 * 書店サンプル用 Hono アプリを生成する。
 * Hikari HTTP アダプタを `/api` 配下にマウントし、ヘルスチェックと任意のチャット API を提供する。
 */
export const createApp = ({
  registry,
  engine,
  auditStorage,
  approvalApi,
}: HonoBookstoreOptions) => {
  const httpAdapter = createHttpAdapter(registry, engine, {
    basePath: HIKARI_BASE_PATH,
    resolveExecutionOptions,
    capabilityResultHtml: { uiBasePath: CAPABILITY_UI_PATH },
  });

  const llmChat = resolveLlmFromEnv(registry, engine);
  const authMiddleware = createHikariExecutionOptionsMiddleware(resolveExecutionOptions);

  const app = new Hono<HikariHonoEnv>()
    .get('/health', (c) =>
      c.json({
        status: 'ok',
        service: 'hono-bookstore',
        capabilities: registry.list().length,
        chat: llmChat
          ? { enabled: true, provider: llmChat.provider }
          : { enabled: false },
        ui: {
          capabilities: CAPABILITY_UI_PATH,
          traces: '/traces',
          approvals: '/approvals',
        },
      }),
    )
    .use('/api/*', authMiddleware)
    .use('/approvals/*', authMiddleware);

  const withTraces = mountHikariTraceViewer(app, { storage: auditStorage });
  const withApprovals = mountHikariApprovals(withTraces, { approvals: approvalApi });

  const withChat = mountHikariChat(withApprovals, {
    llmChat,
    chatPath: `${HIKARI_BASE_PATH}/chat`,
    serveUi: false,
    missingApiKeyMessage: missingLlmApiKeyMessage,
  });

  const withApi = mountHikariHttpAdapter(withChat, httpAdapter, {
    basePath: HIKARI_BASE_PATH,
  });
  return mountHikariCapabilityUi(withApi, {
    registry,
    apiBasePath: HIKARI_BASE_PATH,
    uiBasePath: CAPABILITY_UI_PATH,
    enableDevSession: true,
  });
};
