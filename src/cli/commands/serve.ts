import { loadRegistryFrom } from '../loader.js';
import type { CliCommand } from '../index.js';
import { createServeDependencies, resolveServeFlags } from '../serve-deps.js';

export const serveCommand: CliCommand = async (ctx, args) => {
  const flags = resolveServeFlags(args);

  try {
    const { registry, runtime = {} } = await loadRegistryFrom(flags.entry);
    const startup = await createServeDependencies(ctx, flags, registry, runtime);
    if (!startup.ok) {
      return startup.exitCode;
    }
    const deps = startup.deps;

    const { createChatServer } = await import('../../web/chat-server.js');
    const { resolveRedisUrl } = await import('../../redis.js');

    const server = createChatServer(deps.backend, {
      port: flags.port,
      sessions: deps.sessionMgr,
      approvals: deps.approvalApi,
      resolveExecutionOptions: deps.resolveExecutionOptions,
      rateLimitGuard: deps.rateLimitGuard,
      devtools: { storage: deps.storage, registry: deps.registry },
      enableDevSession: deps.devSessionEnabled,
      httpApi: {
        registry: deps.registry,
        engine: deps.engine,
        basePath: '/api',
        capabilityResultHtml: deps.devSessionEnabled
          ? { uiBasePath: '/capabilities' }
          : undefined,
      },
    });

    const { port: actualPort, host } = await server.listen();
    ctx.stdout.write(`Hikari Chat Server running at http://${host}:${actualPort}\n`);
    ctx.stdout.write(`  LLM backend:  ${deps.llmProvider} (LLM_PROVIDER / API keys)\n`);
    ctx.stdout.write(`  Traces:       http://${host}:${actualPort}/traces\n`);
    ctx.stdout.write(`  Capabilities: http://${host}:${actualPort}/capabilities\n`);
    ctx.stdout.write(`  Cap forms:    http://${host}:${actualPort}/capabilities/<name>/form\n`);
    if (deps.devSessionEnabled) {
      ctx.stdout.write(
        `  Dev session:  http://${host}:${actualPort}/capabilities/dev-session\n`,
      );
    }
    ctx.stdout.write(`  REST API:     http://${host}:${actualPort}/api/capabilities\n`);
    ctx.stdout.write(`  OpenAPI:      http://${host}:${actualPort}/api/openapi.json\n`);
    if (deps.queueMode) {
      ctx.stdout.write(`  Approvals:    http://${host}:${actualPort}/approvals\n`);
      const approvalMode = flags.useApprovalRedis
        ? `Redis queue (${resolveRedisUrl(flags.redisUrl)})`
        : flags.approvalFilePath
          ? `file queue (${flags.approvalFilePath})`
          : 'in-memory queue';
      ctx.stdout.write(
        `Approval: ${approvalMode} (POST /approvals/:id/approve|reject, or /approve /reject in chat)\n`,
      );
      if (flags.useApprovalRedis) {
        ctx.stdout.write(
          'Note: With --approval-redis, all serve instances share pending state via Redis (no file watcher needed).\n',
        );
      }
      if (flags.approvalFilePath) {
        ctx.stdout.write(
          'Approval resume: pending requests survive process restarts via the approval file; file store syncFromSnapshot resolves blocked gates.\n',
        );
      }
      if (deps.envNotifierCount > 0) {
        ctx.stdout.write(
          'Approval webhooks: HIKARI_APPROVAL_WEBHOOK_URL / HIKARI_SLACK_WEBHOOK_URL (queued, fail-open)\n',
        );
      }
    } else {
      ctx.stdout.write('Approval: devAutoApprove (development only)\n');
    }
    if (flags.auditFilePath) {
      ctx.stdout.write(`Audit: JSONL file ${flags.auditFilePath}\n`);
    } else {
      ctx.stdout.write('Audit: in-memory (use --audit-file <path> to persist)\n');
    }
    if (flags.useIdempotencyRedis) {
      ctx.stdout.write(`Idempotency: Redis (${resolveRedisUrl(flags.redisUrl)})\n`);
    } else if (flags.idempotencyFilePath) {
      ctx.stdout.write(`Idempotency: JSONL file ${flags.idempotencyFilePath}\n`);
    }
    if (flags.useRateLimitRedis || flags.rateLimitRedisFromEnv) {
      ctx.stdout.write(`Rate limit: Redis sliding window (${resolveRedisUrl(flags.redisUrl)})\n`);
    }
    if (flags.approvalLogFilePath) {
      ctx.stdout.write(`Approval log: JSONL file ${flags.approvalLogFilePath}\n`);
    }
    ctx.stdout.write(`Press Ctrl+C to stop.\n`);

    await new Promise<void>((resolve) => {
      const shutdown = (): void => {
        ctx.stdout.write('\nShutting down…\n');
        if (flags.approvalFilePath && 'dispose' in deps.approvalStore) {
          (deps.approvalStore as { dispose: () => void }).dispose();
        }
        server
          .close()
          .then(() => deps.redisDisconnect?.())
          .then(resolve)
          .catch(resolve);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });

    return 0;
  } catch (err) {
    ctx.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
};
