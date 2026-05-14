import type { ExecutionContext, Policy, SideEffectType } from './capability.js';

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
 * `requiresApproval` が設定されているか、`sideEffects` に `financial` または `irreversible` が含まれる場合に `true` になる。
 */
export function needsHumanApproval(policy: Policy): boolean {
  return (
    policy.requiresApproval === true ||
    policy.sideEffects.includes('irreversible') ||
    policy.sideEffects.includes('financial')
  );
}

/** 承認プロンプトや監査レコードに表示するために、最もリスクの高い副作用を文字列で返す。 */
export function describeRisk(sideEffects: SideEffectType[]): string {
  if (sideEffects.includes('financial')) return 'financial';
  if (sideEffects.includes('irreversible')) return 'irreversible';
  if (sideEffects.includes('external')) return 'external';
  if (sideEffects.includes('write')) return 'write';
  return 'read-only';
}
