/**
 * Hono + Hikari 書店サンプルのエントリポイント。
 *
 * 実行: npx tsx examples/hono-bookstore/index.ts
 * hikari serve（Tamagui UI）: npx hikari serve --entry examples/bookstore/registry.ts
 */
import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { createBookstoreEngine } from './engine.js';

export { registry } from '../bookstore/registry.js';

const { engine, registry, auditStorage, approvalApi } = createBookstoreEngine();
const app = createApp({ engine, registry, auditStorage, approvalApi });

const port = Number(process.env.PORT ?? 3100);

const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
};

const startHonoBookstore = (): void => {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Hono bookstore listening on http://localhost:${info.port}`);
    console.log(`  Health:       GET  /health`);
    console.log(`  Traces:       GET  /traces`);
    console.log(`  Approvals:    GET  /approvals`);
    console.log(`  Cap UI:       GET  /capabilities`);
    console.log(`  Capabilities: GET  /api/capabilities`);
    console.log(`  Execute:      POST /api/capabilities/<name>`);
    console.log(`  OpenAPI:      GET  /api/openapi.json`);
    console.log(
      `  Chat:         POST /api/chat (ANTHROPIC_API_KEY and/or OPENAI_API_KEY; optional LLM_PROVIDER)`,
    );
  });
};

if (isDirectRun()) {
  startHonoBookstore();
}

export { app, engine, port, startHonoBookstore };
