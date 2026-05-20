import type { Registry } from './registry.js';
import { resolveEffectivePolicy } from './policy.js';
import { hashCapabilityInput } from './idempotency-store.js';
import type { ExecutionOptions } from './execution.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

const truncateIdempotencyKey = (key: string): string =>
  key.length <= MAX_IDEMPOTENCY_KEY_LENGTH
    ? key
    : key.slice(0, MAX_IDEMPOTENCY_KEY_LENGTH);

/**
 * LLM ツール呼び出し向けの冪等キーを組み立てる。
 * `traceId` がある場合は `{traceId}:{toolCallId}`、なければ `toolCallId` のみ。
 */
export const buildToolIdempotencyKey = (params: {
  readonly traceId?: string;
  readonly toolCallId: string;
}): string => {
  const raw = params.traceId
    ? `${params.traceId}:${params.toolCallId}`
    : params.toolCallId;
  return truncateIdempotencyKey(raw);
};

/**
 * devtools invoker 向けの冪等キー（同一 user・capability・input で安定）。
 */
export const buildInvokerIdempotencyKey = (params: {
  readonly userId: string;
  readonly capabilityName: string;
  readonly input: unknown;
}): string => {
  const inputHash = hashCapabilityInput(params.input).slice(0, 32);
  const raw = `devtools:${params.userId}:${params.capabilityName}:${inputHash}`;
  return truncateIdempotencyKey(raw);
};

/** `enrichExecutionOptionsWithIdempotency` のキー生成元。 */
export type IdempotencyKeySource = {
  readonly toolCallId?: string;
  readonly input?: unknown;
};

/**
 * write / financial ケイパビリティで `idempotencyKey` が未設定のとき、
 * アダプター層で自動付与する（既存キーは上書きしない）。
 */
export const enrichExecutionOptionsWithIdempotency = (
  registry: Registry,
  capabilityName: string,
  options: ExecutionOptions,
  source: IdempotencyKeySource,
): ExecutionOptions => {
  if (options.idempotencyKey) {
    return options;
  }

  const capability = registry.get(capabilityName);
  if (!capability) {
    return options;
  }

  const { requiresIdempotencyKey } = resolveEffectivePolicy(capability.policy);
  if (!requiresIdempotencyKey) {
    return options;
  }

  const idempotencyKey = source.toolCallId
    ? buildToolIdempotencyKey({
        traceId: options.traceId,
        toolCallId: source.toolCallId,
      })
    : buildInvokerIdempotencyKey({
        userId: options.userId,
        capabilityName,
        input: source.input ?? {},
      });

  return { ...options, idempotencyKey };
};
