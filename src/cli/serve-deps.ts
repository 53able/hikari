import type { CliContext } from './index.js';
import type { ApprovalRequest } from '../core/approval.js';
import type { ApprovalApi, ApprovalStore } from '../core/approval-store.js';
import type { ApprovalGate } from '../core/approval.js';
import type { AuditLogger, AuditStorage } from '../core/audit.js';
import type { Engine } from '../core/execution.js';
import type { IdempotencyStore } from '../core/idempotency-store.js';
import type { RateLimitGuard } from '../core/rate-limit.js';
import type { Registry } from '../core/registry.js';
import type { CapabilityRuntime, Policy } from '../core/capability.js';
import type { SessionManager } from '../agent/session.js';
import type { ChatBackend } from '../web/chat-stream.js';
import type { ExecutionOptions } from '../core/execution.js';
import type { HikariHarness } from '../adapters/pi.js';
import type { HikariRedis } from '../storage/redis/redis-client.js';

/** `hikari serve` の CLI フラグ。 */
export type ServeFlags = {
  readonly port: number;
  readonly entry: string;
  readonly useApprovalQueue: boolean;
  readonly auditFilePath?: string;
  readonly approvalFilePath?: string;
  readonly approvalLogFilePath?: string;
  readonly idempotencyFilePath?: string;
  readonly redisUrl?: string;
  readonly useIdempotencyRedis: boolean;
  readonly useApprovalRedis: boolean;
  readonly useRateLimitRedis: boolean;
  readonly rateLimitRedisFromEnv: boolean;
  readonly useAnyRedis: boolean;
};

/** `createServeDependencies` の成功時ペイロード。 */
export type ServeDependencies = {
  readonly registry: Registry;
  readonly runtime: CapabilityRuntime;
  readonly redis?: HikariRedis;
  readonly redisDisconnect?: () => Promise<void>;
  readonly storage: AuditStorage;
  readonly auditLog: AuditLogger;
  readonly idempotencyStore: IdempotencyStore;
  readonly rateLimitGuard: RateLimitGuard;
  readonly sessionMgr: SessionManager;
  readonly queueMode: boolean;
  readonly approvalStore: ApprovalStore;
  readonly approvalApi?: ApprovalApi;
  readonly approvalGate: ApprovalGate;
  readonly approvalNotifiers: Map<string, (req: ApprovalRequest) => void>;
  readonly engine: Engine;
  readonly hikariHarness: HikariHarness;
  readonly backend: ChatBackend;
  readonly llmProvider: string;
  readonly resolveExecutionOptions: (req: Request) => ExecutionOptions | Promise<ExecutionOptions>;
  readonly devSessionEnabled: boolean;
  readonly envNotifierCount: number;
};

export type ServeStartupResult =
  | { readonly ok: true; readonly deps: ServeDependencies }
  | { readonly ok: false; readonly exitCode: number; readonly messages: readonly string[] };

/**
 * `hikari serve` の CLI 引数をパースする。
 */
export const resolveServeFlags = (args: readonly string[]): ServeFlags => {
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
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (args[i] === '--entry' && args[i + 1]) {
      entry = args[++i];
    } else if (args[i] === '--approval-queue') {
      useApprovalQueue = true;
    } else if (args[i] === '--audit-file' && args[i + 1]) {
      auditFilePath = args[++i];
    } else if (args[i] === '--approval-file' && args[i + 1]) {
      approvalFilePath = args[++i];
    } else if (args[i] === '--approval-log-file' && args[i + 1]) {
      approvalLogFilePath = args[++i];
    } else if (args[i] === '--idempotency-file' && args[i + 1]) {
      idempotencyFilePath = args[++i];
    } else if (args[i] === '--redis-url' && args[i + 1]) {
      redisUrl = args[++i];
    } else if (args[i] === '--idempotency-redis') {
      useIdempotencyRedis = true;
    } else if (args[i] === '--approval-redis') {
      useApprovalRedis = true;
    } else if (args[i] === '--rate-limit-redis') {
      useRateLimitRedis = true;
    }
  }

  const rateLimitRedisFromEnv = process.env.HIKARI_RATE_LIMIT_REDIS === '1';
  const useAnyRedis =
    useIdempotencyRedis || useApprovalRedis || useRateLimitRedis || rateLimitRedisFromEnv;

  return {
    port,
    entry,
    useApprovalQueue,
    auditFilePath,
    approvalFilePath,
    approvalLogFilePath,
    idempotencyFilePath,
    redisUrl,
    useIdempotencyRedis,
    useApprovalRedis,
    useRateLimitRedis,
    rateLimitRedisFromEnv,
    useAnyRedis,
  };
};

const resolveIdempotencyStore = (
  flags: ServeFlags,
  redis: HikariRedis | undefined,
  createRedisIdempotencyStore: (r: HikariRedis) => IdempotencyStore,
  createFileIdempotencyStore: (path: string) => IdempotencyStore,
  createInMemoryIdempotencyStore: () => IdempotencyStore,
): IdempotencyStore => {
  if (flags.useIdempotencyRedis && redis) {
    return createRedisIdempotencyStore(redis);
  }
  if (flags.idempotencyFilePath) {
    return createFileIdempotencyStore(flags.idempotencyFilePath);
  }
  return createInMemoryIdempotencyStore();
};

const resolveApprovalStore = async (
  flags: ServeFlags,
  redis: HikariRedis | undefined,
  createRedisApprovalStore: (r: HikariRedis) => ApprovalStore,
  createFileApprovalStore: (path: string) => Promise<ApprovalStore>,
  createInMemoryApprovalStore: () => ApprovalStore,
): Promise<ApprovalStore> => {
  if (flags.useApprovalRedis && redis) {
    return createRedisApprovalStore(redis);
  }
  if (flags.approvalFilePath) {
    return createFileApprovalStore(flags.approvalFilePath);
  }
  return createInMemoryApprovalStore();
};

const validateApprovalStartup = (
  flags: ServeFlags,
  registry: Registry,
  needsHumanApproval: (policy: Policy) => boolean,
): { readonly ok: true } | { readonly ok: false; readonly messages: readonly string[] } => {
  const isProduction = process.env.NODE_ENV === 'production';
  const queueMode =
    isProduction ||
    flags.useApprovalQueue ||
    flags.approvalFilePath !== undefined ||
    flags.useApprovalRedis;

  const hasApprovalCapabilities = registry.getAll().some((cap) =>
    needsHumanApproval(cap.policy),
  );

  if (!queueMode && hasApprovalCapabilities) {
    const allowDevApproval = process.env.HIKARI_ALLOW_DEV_APPROVAL === '1';
    if (!allowDevApproval) {
      return {
        ok: false,
        messages: [
          'Refusing to start: registry includes capabilities that require human approval, but approval queue mode is off.',
          'Use --approval-queue, --approval-file, --approval-redis, or set HIKARI_ALLOW_DEV_APPROVAL=1 for devAutoApprove (development only).',
        ],
      };
    }
    return {
      ok: true,
    };
  }
  return { ok: true };
};

/**
 * `hikari serve` 用のストレージ・承認・エンジン・チャット backend を組み立てる。
 */
export const createServeDependencies = async (
  ctx: CliContext,
  flags: ServeFlags,
  registry: Registry,
  runtime: CapabilityRuntime,
): Promise<ServeStartupResult> => {
  const {
    createAuditLog,
    createInMemoryStorage,
    devAutoApprove,
    createInMemoryApprovalStore,
    createApprovalApi,
    createInMemoryIdempotencyStore,
    approvalNotifiersFromEnv,
    composeApprovalNotifiers,
    createQueuedApprovalNotifier,
  } = await import('../core/index.js');
  const {
    createJsonlAuditStorage,
    createFileApprovalStore,
    createApprovalFileLogger,
    wrapApprovalApiWithFileLog,
    createFileIdempotencyStore,
  } = await import('../file.js');
  const {
    connectHikariRedis,
    resolveRedisUrl,
    createRedisIdempotencyStore,
    createRedisApprovalStore,
    createServeRateLimitGuard,
  } = await import('../redis.js');
  const { resolveServeChatBackend } = await import('../adapters/llm-provider.js');
  const { createHikariHarness } = await import('../adapters/pi.js');
  const { createSessionManager } = await import('../agent/session.js');
  const { createHeaderExecutionOptionsResolver } = await import('../web/auth.js');
  const { needsHumanApproval } = await import('../core/policy.js');

  const approvalCheck = validateApprovalStartup(flags, registry, needsHumanApproval);
  if (!approvalCheck.ok) {
    for (const message of approvalCheck.messages) {
      ctx.stderr.write(`${message}\n`);
    }
    return { ok: false, exitCode: 1, messages: approvalCheck.messages };
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const queueMode =
    isProduction ||
    flags.useApprovalQueue ||
    flags.approvalFilePath !== undefined ||
    flags.useApprovalRedis;

  const hasApprovalCapabilities = registry.getAll().some((cap) =>
    needsHumanApproval(cap.policy),
  );
  if (!queueMode && hasApprovalCapabilities && process.env.HIKARI_ALLOW_DEV_APPROVAL === '1') {
    ctx.stderr.write(
      'Warning: using devAutoApprove because HIKARI_ALLOW_DEV_APPROVAL=1 (not for staging/production).\n',
    );
  }

  if (!flags.auditFilePath) {
    ctx.stderr.write(
      'Note: audit log is in-memory only; use --audit-file <path> to persist traces across restarts.\n',
    );
  }
  if (queueMode && !flags.approvalFilePath && !flags.useApprovalRedis) {
    ctx.stderr.write(
      'Note: approval queue is in-memory; pending requests are lost on restart. Use --approval-file or --approval-redis.\n',
    );
  }

  let redisDisconnect: (() => Promise<void>) | undefined;
  let redis: HikariRedis | undefined;

  if (flags.useAnyRedis) {
    const connected = await connectHikariRedis({
      url: resolveRedisUrl(flags.redisUrl),
      label: 'hikari serve Redis',
    });
    redis = connected.redis;
    redisDisconnect = connected.disconnect;
  }

  const storage = flags.auditFilePath
    ? createJsonlAuditStorage(flags.auditFilePath)
    : createInMemoryStorage();
  const auditLog = createAuditLog(storage);

  const idempotencyStore = resolveIdempotencyStore(
    flags,
    redis,
    createRedisIdempotencyStore,
    createFileIdempotencyStore,
    createInMemoryIdempotencyStore,
  );

  const rateLimitGuard = createServeRateLimitGuard(
    redis,
    flags.useRateLimitRedis || flags.rateLimitRedisFromEnv,
  );

  const sessionMgr = createSessionManager();
  const approvalNotifiers = new Map<string, (req: ApprovalRequest) => void>();

  const approvalStore = await resolveApprovalStore(
    flags,
    redis,
    createRedisApprovalStore,
    createFileApprovalStore,
    createInMemoryApprovalStore,
  );

  const approvalLogger = flags.approvalLogFilePath
    ? createApprovalFileLogger(flags.approvalLogFilePath)
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

  const hikariHarness = createHikariHarness({
    registry,
    auditLog,
    approvalGate,
    idempotencyStore,
    runtime,
  });
  const engine = hikariHarness.engine;

  const { backend, provider: llmProvider } = resolveServeChatBackend({
    registry,
    engine,
    harnessApi: hikariHarness,
    onRegisterApprovalNotifier: (traceId, notify) => {
      approvalNotifiers.set(traceId, notify);
      return () => approvalNotifiers.delete(traceId);
    },
  });

  const devSessionEnabled = process.env.HIKARI_DEV_SESSION !== '0';
  const resolveExecutionOptions = createHeaderExecutionOptionsResolver({
    readCookies: devSessionEnabled,
  });

  return {
    ok: true,
    deps: {
      registry,
      runtime,
      redis,
      redisDisconnect,
      storage,
      auditLog,
      idempotencyStore,
      rateLimitGuard,
      sessionMgr,
      queueMode,
      approvalStore,
      approvalApi,
      approvalGate,
      approvalNotifiers,
      engine,
      hikariHarness,
      backend,
      llmProvider,
      resolveExecutionOptions,
      devSessionEnabled,
      envNotifierCount: envNotifiers.length,
    },
  };
};
