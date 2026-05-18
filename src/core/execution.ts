import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Capability, ExecutionContext } from './capability.js';
import type { AuditLogger } from './audit.js';
import { evaluatePolicy, needsHumanApproval, describeRisk, PolicyViolationError } from './policy.js';
import type { ApprovalGate } from './approval.js';
import { ApprovalDeniedError } from './approval.js';
import type { Registry } from './registry.js';
import type { HarnessTracer } from './harness-trace.js';
import { buildHarnessPlan } from './harness-plan.js';
import { scrubAuditPayload } from './audit-scrub.js';
import type { IdempotencyStore } from './idempotency-store.js';
import {
  buildIdempotencyStoreKey,
  hashCapabilityInput,
} from './idempotency-store.js';

/** エンジン呼び出し時に呼び出し元が渡すオプションの Zod スキーマ。 */
export const executionOptionsSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().optional(),
  traceId: z.string().optional(),
  intent: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  /** 同一キー・同一入力の再実行時にキャッシュ結果を返す（TTL 内）。 */
  idempotencyKey: z.string().min(1).max(256).optional(),
});

/** エンジン呼び出し時に呼び出し元が渡すオプション。 */
export type ExecutionOptions = z.infer<typeof executionOptionsSchema>;

/** `permissions` を常に配列にした実行オプション（Hono Variables 等で利用）。 */
export type NormalizedExecutionOptions = ExecutionOptions & {
  readonly permissions: readonly string[];
};

/**
 * 省略可能な `permissions` を空配列に正規化する。
 * @param options - 生の実行オプション。
 */
export const normalizeExecutionOptions = (
  options: ExecutionOptions,
): NormalizedExecutionOptions => ({
  ...options,
  permissions: options.permissions ?? [],
});

/** `Engine.execute` が成功時に返す結果オブジェクト。 */
export interface ExecutionResult<T = unknown> {
  success: true;
  /** Zod バリデーション後の型安全なハンドラー出力。 */
  output: T;
  /** この呼び出しの全監査エントリが共有するトレースID。 */
  traceId: string;
}

/** `Engine.execute` でレジストリに存在しないケイパビリティ名が指定されたときにスローされる。HTTPアダプターは HTTP 404 にマップする。 */
export class CapabilityNotFoundError extends Error {
  constructor(name: string) {
    super(`Capability '${name}' not found in registry`);
    this.name = 'CapabilityNotFoundError';
  }
}

/**
 * 同一 `idempotencyKey` が別ケイパビリティまたは別入力で再利用されたときにスローされる。
 * HTTP アダプターは HTTP 409 にマップする。
 */
export class IdempotencyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(
      `Idempotency key '${idempotencyKey}' was already used with a different capability or input`,
    );
    this.name = 'IdempotencyConflictError';
  }
}

/** ハンドラー呼び出し前に入力値が Zod スキーマのパースに失敗したときにスローされる。HTTPアダプターは HTTP 400 にマップする。 */
export class ValidationError extends Error {
  constructor(
    /** フィールドパスとメッセージを含む Zod のバリデーションエラー詳細。 */
    public readonly issues: { message: string; path: (string | number)[] }[],
    /** バリデーションに失敗したケイパビリティ名。 */
    capabilityName: string,
  ) {
    super(`Input validation failed for '${capabilityName}'`);
    this.name = 'ValidationError';
  }
}

/**
 * ケイパビリティ実行エンジン。
 * 入力バリデーション→ポリシーチェック→承認ゲート→ハンドラー実行→監査記録を1回の `execute` 呼び出しで処理する。
 */
export type Engine = {
  /**
   * 名前でケイパビリティを実行する。
   * @param capabilityName - 登録済みケイパビリティの `name` と一致する必要がある。
   * @param input - 未検証の生入力。エンジンがケイパビリティの `inputSchema` でパースする。
   * @param options - 呼び出し元の識別情報と権限。
   * @throws {CapabilityNotFoundError} `capabilityName` が登録されていない場合。
   * @throws {ValidationError} `input` がケイパビリティの Zod スキーマに不適合な場合。
   * @throws {PolicyViolationError} 呼び出し元が必要な権限を持っていない場合。
   * @throws {ApprovalDeniedError} 承認ゲートがリクエストを拒否した場合。
   */
  readonly execute: <T = unknown>(
    capabilityName: string,
    input: unknown,
    options: ExecutionOptions,
  ) => Promise<ExecutionResult<T>>;
};

type EngineConfig = {
  registry: Registry;
  auditLog: AuditLogger;
  approvalGate?: ApprovalGate;
  idempotencyStore?: IdempotencyStore;
  /** 指定時は `execute` 内で intent / plan / tool 選択を harness 監査イベントとして記録する。 */
  harness?: HarnessTracer;
};

/**
 * ケイパビリティ実行エンジンを生成する。
 *
 * @param config.registry - ケイパビリティ定義のソース。
 * @param config.auditLog - 各ライフサイクルステップで監査イベントを受け取る。
 * @param config.approvalGate - `requiresApproval: true` のケイパビリティが存在する場合に必須。
 */
type AuditPayload = {
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
};

const recordAudit = async (
  auditLog: AuditLogger,
  capability: Capability,
  type: Parameters<AuditLogger['record']>[0],
  capabilityName: string,
  context: ExecutionContext,
  data?: AuditPayload,
): Promise<void> => {
  if (capability.policy.auditLevel === 'none') return;
  const scrubbed = scrubAuditPayload(capability.policy.auditLevel, data);
  await auditLog.record(type, capabilityName, context, scrubbed);
};

export function createEngine(config: EngineConfig): Engine {
  return {
    execute: <T>(name: string, input: unknown, options: ExecutionOptions) =>
      runCapability<T>(name, input, options, config),
  };
}

const recordHarnessForExecute = async (
  harness: HarnessTracer,
  registry: Registry,
  capabilityName: string,
  context: ExecutionContext,
  toolInput: unknown,
): Promise<void> => {
  const base = {
    traceId: context.traceId,
    userId: context.userId,
    sessionId: context.sessionId,
    intent: context.intent,
  };
  if (context.intent) {
    await harness.recordIntent(base);
  }
  await harness.recordPlan({
    ...base,
    plan: buildHarnessPlan(registry),
  });
  await harness.recordToolSelected({
    ...base,
    capabilityName,
    toolInput,
  });
};

async function runCapability<T>(
  capabilityName: string,
  input: unknown,
  options: ExecutionOptions,
  { registry, auditLog, approvalGate, idempotencyStore, harness }: EngineConfig,
): Promise<ExecutionResult<T>> {
  const capability = registry.get(capabilityName);
  if (!capability) throw new CapabilityNotFoundError(capabilityName);

  const inputHash = hashCapabilityInput(input);
  if (options.idempotencyKey && idempotencyStore) {
    const storeKey = buildIdempotencyStoreKey(options.idempotencyKey);
    const cached = await idempotencyStore.get(storeKey);
    if (cached) {
      if (cached.capabilityName !== capabilityName || cached.inputHash !== inputHash) {
        throw new IdempotencyConflictError(options.idempotencyKey);
      }
      return cached.result as ExecutionResult<T>;
    }
  }

  const context: ExecutionContext = {
    userId: options.userId,
    sessionId: options.sessionId ?? randomUUID(),
    traceId: options.traceId ?? randomUUID(),
    intent: options.intent,
    permissions: new Set(options.permissions ?? []),
  };

  await recordAudit(auditLog, capability, 'capability_invoked', capabilityName, context, { input });

  // Validate input
  const parseResult = capability.inputSchema.safeParse(input);
  if (!parseResult.success) {
    await recordAudit(auditLog, capability, 'execution_failed', capabilityName, context, {
      input,
      error: 'Input validation failed',
    });
    throw new ValidationError(parseResult.error.issues, capabilityName);
  }

  // Policy check
  try {
    evaluatePolicy(capabilityName, capability.policy, context);
  } catch (err) {
    if (err instanceof PolicyViolationError) {
      await recordAudit(auditLog, capability, 'policy_denied', capabilityName, context, {
        input,
        error: err.message,
      });
    }
    throw err;
  }

  if (harness) {
    await recordHarnessForExecute(
      harness,
      registry,
      capabilityName,
      context,
      parseResult.data,
    );
  }

  // Approval gate for high-risk operations
  if (needsHumanApproval(capability.policy, parseResult.data)) {
    if (!approvalGate) {
      throw new Error(
        `Capability '${capabilityName}' requires approval but no ApprovalGate is configured`,
      );
    }
    const riskLevel = describeRisk(capability.policy.sideEffects);
    await recordAudit(auditLog, capability, 'approval_requested', capabilityName, context, {
      input: parseResult.data,
      metadata: { riskLevel },
    });

    const requestId = randomUUID();
    const result = await approvalGate({
      id: requestId,
      capabilityName,
      input: parseResult.data,
      context,
      riskLevel,
      requestedAt: new Date(),
    });

    if (!result.approved) {
      await recordAudit(auditLog, capability, 'approval_denied', capabilityName, context, {
        input: parseResult.data,
        metadata: { reason: result.reason },
      });
      throw new ApprovalDeniedError(requestId, capabilityName, result.reason);
    }

    await recordAudit(auditLog, capability, 'approval_granted', capabilityName, context, {
      input: parseResult.data,
      metadata: { approvedBy: result.approvedBy },
    });
  }

  // Execute handler
  try {
    const output = await capability.handler(parseResult.data, context);
    await recordAudit(auditLog, capability, 'execution_succeeded', capabilityName, context, {
      input: parseResult.data,
      output,
    });
    const result: ExecutionResult<T> = {
      success: true,
      output: output as T,
      traceId: context.traceId,
    };
    if (options.idempotencyKey && idempotencyStore) {
      const storeKey = buildIdempotencyStoreKey(options.idempotencyKey);
      await idempotencyStore.set(storeKey, {
        capabilityName,
        inputHash,
        result,
        createdAt: Date.now(),
      });
    }
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await recordAudit(auditLog, capability, 'execution_failed', capabilityName, context, {
      input: parseResult.data,
      error: errorMessage,
    });
    throw err;
  }
}
