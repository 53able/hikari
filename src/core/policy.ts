import type { ApprovalPredicate, ExecutionContext, Policy, SideEffectType } from './capability.js';

/** 呼び出し元が必要な権限を持っていないときにスローされる。HTTPアダプターは HTTP 403 にマップする。 */
export class PolicyViolationError extends Error {
  constructor(
    /** 違反の内容を示す人間可読の説明（例: "Missing required permission: admin"）。 */
    public readonly reason: string,
    /** ポリシー違反が発生したケイパビリティ名。 */
    public readonly capabilityName: string,
  ) {
    super(`Policy violation for '${capabilityName}': ${reason}`);
    this.name = 'PolicyViolationError';
  }
}

/**
 * ケイパビリティのポリシーが要求する全権限を呼び出し元が保持しているかを検証する。
 *
 * @throws {PolicyViolationError} 最初に不足している権限が見つかった時点でスローする。
 */
export function evaluatePolicy(
  capabilityName: string,
  policy: Policy,
  context: ExecutionContext,
): void {
  for (const permission of policy.requiredPermissions) {
    if (!context.permissions.has(permission)) {
      throw new PolicyViolationError(
        `Missing required permission: ${permission}`,
        capabilityName,
      );
    }
  }
}

/**
 * ハンドラー実行前に人間による承認が必要かどうかを返す。
 * `requiresApproval`・高リスク副作用・`requiresApprovalWhen` のいずれかで `true` になる。
 *
 * @param policy - ケイパビリティのポリシー定義。
 * @param input - Zod パース済み入力。`requiresApprovalWhen` 評価に使用する。
 */
export const needsHumanApproval = (policy: Policy, input?: unknown): boolean => {
  if (policy.requiresApprovalWhen && input !== undefined && policy.requiresApprovalWhen(input)) {
    return true;
  }
  return (
    policy.requiresApproval === true ||
    policy.sideEffects.includes('irreversible') ||
    policy.sideEffects.includes('financial')
  );
};

/**
 * ポリシー DSL 用のビルダー。定義時に承認条件を宣言しやすくする。
 *
 * @example
 * ```ts
 * policy: {
 *   ...policy.role('accounting'),
 *   sideEffects: ['write', 'financial'],
 *   ...policy.requiresApprovalWhen((input) => input.amount > 100_000),
 *   auditLevel: 'full',
 * }
 * ```
 */
export const policy = {
  /** 単一ロールを `requiredPermissions` に追加する。 */
  role: (permission: string): Pick<Policy, 'requiredPermissions'> => ({
    requiredPermissions: [permission],
  }),
  /** 条件付き承認述語を返す。 */
  requiresApprovalWhen: <T>(predicate: ApprovalPredicate<T>): Pick<Policy, 'requiresApprovalWhen'> => ({
    requiresApprovalWhen: predicate as ApprovalPredicate,
  }),
  /** 認証済みユーザーのみ（慣例的な `authenticated` 権限）。 */
  authenticated: (): Pick<Policy, 'requiredPermissions'> => ({
    requiredPermissions: ['authenticated'],
  }),
} as const;

/** `resolveEffectivePolicy` の戻り値。宣言ポリシーに実行時の昇格ルールを反映する。 */
export type EffectivePolicy = {
  readonly policy: Policy;
  readonly auditLevel: Policy['auditLevel'];
  readonly requiresApproval: boolean;
  /** `sideEffects` に `external` が含まれる場合は `true`（レート制限必須）。 */
  readonly requiresRateLimit: boolean;
};

/**
 * 副作用に基づき監査レベル・承認・レート制限要件を解決する。
 * - `write` / `financial` / `irreversible` を含む場合、`basic` 監査は `full` に昇格
 * - `external` を含む場合はレート制限が必須
 */
export const resolveEffectivePolicy = (
  policy: Policy,
  input?: unknown,
): EffectivePolicy => {
  const auditEscalation: readonly SideEffectType[] = ['write', 'financial', 'irreversible'];
  const hasElevatedSideEffect = policy.sideEffects.some((effect) =>
    auditEscalation.includes(effect),
  );
  const auditLevel =
    hasElevatedSideEffect && policy.auditLevel === 'basic' ? 'full' : policy.auditLevel;

  return {
    policy,
    auditLevel,
    requiresApproval: needsHumanApproval(policy, input),
    requiresRateLimit: policy.sideEffects.includes('external'),
  };
};

/** 承認プロンプトや監査レコードに表示するために、最もリスクの高い副作用を文字列で返す。 */
export function describeRisk(sideEffects: SideEffectType[]): string {
  if (sideEffects.includes('financial')) return 'financial';
  if (sideEffects.includes('irreversible')) return 'irreversible';
  if (sideEffects.includes('external')) return 'external';
  if (sideEffects.includes('write')) return 'write';
  return 'read-only';
}
