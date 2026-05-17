import { loadRegistryFrom } from '../loader.js';
import type { CliCommand } from '../index.js';
import type { ApprovalRequest } from '../../core/approval.js';

export const serveCommand: CliCommand = async (ctx, args) => {
  let port = 3000;
  let entry = 'src/index.ts';
  let useApprovalQueue = false;
  let auditFilePath: string | undefined;
  let approvalFilePath: string | undefined;
  let approvalLogFilePath: string | undefined;
  let idempotencyFilePath: string | undefined;
  let redisUrl: string | undefined;
  let useIdempotencyRedis = false;
  let useApprovalRedis = false;
  let useRateLimitRedis = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); }
    else if (args[i] === '--entry' && args[i + 1]) { entry = args[++i]; }
    else if (args[i] === '--approval-queue') { useApprovalQueue = true; }
    else if (args[i] === '--audit-file' && args[i + 1]) { auditFilePath = args[++i]; }
    else if (args[i] === '--approval-file' && args[i + 1]) { approvalFilePath = args[++i]; }
    else if (args[i] === '--approval-log-file' && args[i + 1]) { approvalLogFilePath = args[++i]; }
    else if (args[i] === '--idempotency-file' && args[i + 1]) { idempotencyFilePath = args[++i]; }
    else if (args[i] === '--redis-url' && args[i + 1]) { redisUrl = args[++i]; }
    else if (args[i] === '--idempotency-redis') { useIdempotencyRedis = true; }
    else if (args[i] === '--approval-redis') { useApprovalRedis = true; }
    else if (args[i] === '--rate-limit-redis') { useRateLimitRedis = true; }
  }

  const rateLimitRedisFromEnv = process.env.HIKARI_RATE_LIMIT_REDIS === '1';
  const useAnyRedis = useIdempotencyRedis || useApprovalRedis || useRateLimitRedis || rateLimitRedisFromEnv;

  try {
    const { registry } = await loadRegistryFrom(entry);

    const {
      createAuditLog,
      createInMemoryStorage,
      createJsonlAuditStorage,
      createEngine,
      devAutoApprove,
      createHarnessTracer,
      createInMemoryApprovalStore,
      createFileApprovalStore,
      createApprovalApi,
      createApprovalFileLogger,
      wrapApprovalApiWithFileLog,
      createInMemoryIdempotencyStore,
      createFileIdempotencyStore,
      createServeRateLimitGuard,
      approvalNotifiersFromEnv,
      composeApprovalNotifiers,
      createQueuedApprovalNotifier,
      connectHikariRedis,
      resolveRedisUrl,
      createRedisIdempotencyStore,
      createRedisApprovalStore,
    } = await import('../../core/index.js');
    const { createChatServer, backendFromPiAgent } = await import('../../web/chat-server.js');
    const { createSessionManager } = await import('../../agent/session.js');
    const { createHeaderExecutionOptionsResolver } = await import('../../web/auth.js');

    let redisDisconnect: (() => Promise<void>) | undefined;
    let redis: Awaited<ReturnType<typeof connectHikariRedis>>['redis'] | undefined;

    if (useAnyRedis) {
      const connected = await connectHikariRedis({
        url: resolveRedisUrl(redisUrl),
        label: 'hikari serve Redis',
      });
      redis = connected.redis;
      redisDisconnect = connected.disconnect;
    }

    const storage = auditFilePath
      ? createJsonlAuditStorage(auditFilePath)
      : createInMemoryStorage();
    const auditLog = createAuditLog(storage);

    const idempotencyStore = useIdempotencyRedis && redis
      ? createRedisIdempotencyStore(redis)
      : idempotencyFilePath
        ? createFileIdempotencyStore(idempotencyFilePath)
        : createInMemoryIdempotencyStore();

    const rateLimitGuard = createServeRateLimitGuard(
      redis,
      useRateLimitRedis || rateLimitRedisFromEnv,
    );

    const harness = createHarnessTracer(auditLog, { registry, auditLevel: 'basic' });
    const sessionMgr = createSessionManager();

    const isProduction = process.env.NODE_ENV === 'production';
    const queueMode =
      isProduction
      || useApprovalQueue
      || approvalFilePath !== undefined
      || useApprovalRedis;

    const approvalNotifiers = new Map<string, (req: ApprovalRequest) => void>();
    const approvalStore = useApprovalRedis && redis
      ? createRedisApprovalStore(redis)
      : approvalFilePath
        ? await createFileApprovalStore(approvalFilePath)
        : createInMemoryApprovalStore();
    const approvalLogger = approvalLogFilePath
      ? createApprovalFileLogger(approvalLogFilePath)
      : undefined;
    const baseApprovalApi = queueMode ? createApprovalApi(approvalStore) : undefined;
    const approvalApi =
      baseApprovalApi && approvalLogger
        ? wrapApprovalApiWithFileLog(baseApprovalApi, approvalStore, approvalLogger)
        : baseApprovalApi;

    const envNotifiers = queueMode
      ? approvalNotifiersFromEnv().map((n) => createQueuedApprovalNotifier(n))
      : [];

    const onPending = composeApprovalNotifiers(
      ...envNotifiers,
      (req: ApprovalRequest) => {
        approvalNotifiers.get(req.context.traceId)?.(req);
      },
      approvalLogger
        ? (req: ApprovalRequest) => {
            void approvalLogger.logPending(req);
          }
        : () => {},
    );

    const approvalGate = queueMode
      ? approvalStore.createGate({ onPending })
      : devAutoApprove;

    const engine = createEngine({
      registry,
      auditLog,
      approvalGate,
      idempotencyStore,
    });

    const backend = backendFromPiAgent({
      registry,
      engine,
      harness,
      onRegisterApprovalNotifier: (traceId, notify) => {
        approvalNotifiers.set(traceId, notify);
        return () => approvalNotifiers.delete(traceId);
      },
    });

    const resolveExecutionOptions = createHeaderExecutionOptionsResolver();

    const server = createChatServer(backend, {
      port,
      sessions: sessionMgr,
      approvals: approvalApi,
      resolveExecutionOptions,
      rateLimitGuard,
      devtools: { storage, registry },
      httpApi: { registry, engine, basePath: '/api' },
    });

    const { port: actualPort, host } = await server.listen();
    ctx.stdout.write(`Hikari Chat Server running at http://${host}:${actualPort}\n`);
    ctx.stdout.write(`  Traces:       http://${host}:${actualPort}/traces\n`);
    ctx.stdout.write(`  Capabilities: http://${host}:${actualPort}/capabilities\n`);
    ctx.stdout.write(`  Cap forms:    http://${host}:${actualPort}/capabilities/<name>/form\n`);
    ctx.stdout.write(`  REST API:     http://${host}:${actualPort}/api/capabilities\n`);
    ctx.stdout.write(`  OpenAPI:      http://${host}:${actualPort}/api/openapi.json\n`);
    if (queueMode) {
      ctx.stdout.write(`  Approvals:    http://${host}:${actualPort}/approvals\n`);
      const approvalMode = useApprovalRedis
        ? `Redis queue (${resolveRedisUrl(redisUrl)})`
        : approvalFilePath
          ? `file queue (${approvalFilePath})`
          : 'in-memory queue';
      ctx.stdout.write(
        `Approval: ${approvalMode} (POST /approvals/:id/approve|reject, or /approve /reject in chat)\n`,
      );
      if (useApprovalRedis) {
        ctx.stdout.write(
          'Note: With --approval-redis, all serve instances share pending state via Redis (no file watcher needed).\n',
        );
      }
      if (envNotifiers.length > 0) {
        ctx.stdout.write('Approval webhooks: HIKARI_APPROVAL_WEBHOOK_URL / HIKARI_SLACK_WEBHOOK_URL (queued, fail-open)\n');
      }
    } else {
      ctx.stdout.write('Approval: devAutoApprove (development only)\n');
    }
    if (auditFilePath) {
      ctx.stdout.write(`Audit: JSONL file ${auditFilePath}\n`);
    } else {
      ctx.stdout.write('Audit: in-memory (use --audit-file <path> to persist)\n');
    }
    if (useIdempotencyRedis) {
      ctx.stdout.write(`Idempotency: Redis (${resolveRedisUrl(redisUrl)})\n`);
    } else if (idempotencyFilePath) {
      ctx.stdout.write(`Idempotency: JSONL file ${idempotencyFilePath}\n`);
    }
    if (useRateLimitRedis || rateLimitRedisFromEnv) {
      ctx.stdout.write(`Rate limit: Redis sliding window (${resolveRedisUrl(redisUrl)})\n`);
    }
    if (approvalLogFilePath) {
      ctx.stdout.write(`Approval log: JSONL file ${approvalLogFilePath}\n`);
    }
    ctx.stdout.write(`Press Ctrl+C to stop.\n`);

    await new Promise<void>((resolve) => {
      const shutdown = (): void => {
        ctx.stdout.write('\nShutting down…\n');
        if (approvalFilePath && 'dispose' in approvalStore) {
          (approvalStore as { dispose: () => void }).dispose();
        }
        server
          .close()
          .then(() => redisDisconnect?.())
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
