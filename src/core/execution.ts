import { randomUUID } from 'crypto';
import type { ExecutionContext } from './capability.js';
import type { AuditLogger } from './audit.js';
import { evaluatePolicy, needsHumanApproval, describeRisk, PolicyViolationError } from './policy.js';
import type { ApprovalGate } from './approval.js';
import { ApprovalDeniedError } from './approval.js';
import type { Registry } from './registry.js';

/** エンジン呼び出し時に呼び出し元が渡すオプション。 */
export interface ExecutionOptions {
  /** 認証済みユーザーの識別子。 */
  userId: string;
  /** この呼び出しのセッションID。省略時はエンジンが UUID を生成する。 */
  sessionId?: string;
  /** トレース相関ID。省略時はエンジンが UUID を生成する。 */
  traceId?: string;
  /** 呼び出し意図を示す人間可読の説明。監査ログに保存される。 */
  intent?: string;
  /** 呼び出し元に付与された権限リスト。`Policy.requiredPermissions` と照合される。 */
  permissions?: string[];
}

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
};

/**
 * ケイパビリティ実行エンジンを生成する。
 *
 * @param config.registry - ケイパビリティ定義のソース。
 * @param config.auditLog - 各ライフサイクルステップで監査イベントを受け取る。
 * @param config.approvalGate - `requiresApproval: true` のケイパビリティが存在する場合に必須。
 */
export function createEngine(config: EngineConfig): Engine {
  return {
    execute: <T>(name: string, input: unknown, options: ExecutionOptions) =>
      runCapability<T>(name, input, options, config),
  };
}

async function runCapability<T>(
  capabilityName: string,
  input: unknown,
  options: ExecutionOptions,
  { registry, auditLog, approvalGate }: EngineConfig,
): Promise<ExecutionResult<T>> {
  const capability = registry.get(capabilityName);
  if (!capability) throw new CapabilityNotFoundError(capabilityName);

  const context: ExecutionContext = {
    userId: options.userId,
    sessionId: options.sessionId ?? randomUUID(),
    traceId: options.traceId ?? randomUUID(),
    intent: options.intent,
    permissions: new Set(options.permissions ?? []),
  };

  await auditLog.record('capability_invoked', capabilityName, context, { input });

  // Validate input
  const parseResult = capability.inputSchema.safeParse(input);
  if (!parseResult.success) {
    await auditLog.record('execution_failed', capabilityName, context, {
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
      await auditLog.record('policy_denied', capabilityName, context, {
        input,
        error: err.message,
      });
    }
    throw err;
  }

  // Approval gate for high-risk operations
  if (needsHumanApproval(capability.policy)) {
    if (!approvalGate) {
      throw new Error(
        `Capability '${capabilityName}' requires approval but no ApprovalGate is configured`,
      );
    }
    const riskLevel = describeRisk(capability.policy.sideEffects);
    await auditLog.record('approval_requested', capabilityName, context, {
      input,
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
      await auditLog.record('approval_denied', capabilityName, context, {
        input,
        metadata: { reason: result.reason },
      });
      throw new ApprovalDeniedError(requestId, capabilityName, result.reason);
    }

    await auditLog.record('approval_granted', capabilityName, context, {
      input,
      metadata: { approvedBy: result.approvedBy },
    });
  }

  // Execute handler
  try {
    const output = await capability.handler(parseResult.data, context);
    await auditLog.record('execution_succeeded', capabilityName, context, {
      input: parseResult.data,
      output,
    });
    return { success: true, output: output as T, traceId: context.traceId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await auditLog.record('execution_failed', capabilityName, context, {
      input: parseResult.data,
      error: errorMessage,
    });
    throw err;
  }
}
