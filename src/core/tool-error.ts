import { z } from 'zod';
import { ApprovalDeniedError } from './approval.js';
import {
  ValidationError,
  IdempotencyConflictError,
  IdempotencyRequiredError,
  CapabilityNotFoundError,
} from './execution.js';
import { PolicyViolationError } from './policy.js';

/** LLM ツール結果に載せる構造化エラーペイロード。 */
export const toolExecutionErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export type ToolExecutionErrorPayload = z.infer<typeof toolExecutionErrorPayloadSchema>;

const payload = (
  code: string,
  message: string,
  retryable: boolean,
): ToolExecutionErrorPayload => ({
  code,
  message,
  retryable,
});

/**
 * エンジン実行エラーを LLM 向けの短い JSON ペイロードに変換する。
 */
export const formatToolExecutionError = (err: unknown): ToolExecutionErrorPayload => {
  if (err instanceof ValidationError) {
    return payload(
      err.phase === 'output' ? 'output_validation_error' : 'validation_error',
      err.message,
      false,
    );
  }
  if (err instanceof PolicyViolationError) {
    return payload('policy_denied', err.message, false);
  }
  if (err instanceof ApprovalDeniedError) {
    return payload('approval_denied', err.message, false);
  }
  if (err instanceof IdempotencyConflictError) {
    return payload('idempotency_conflict', err.message, false);
  }
  if (err instanceof IdempotencyRequiredError) {
    return payload('idempotency_required', err.message, false);
  }
  if (err instanceof CapabilityNotFoundError) {
    return payload('capability_not_found', err.message, false);
  }
  const message = err instanceof Error ? err.message : String(err);
  return payload('execution_error', message, false);
};

/** ペイロードを tool_result 用 JSON 文字列にする。 */
export const serializeToolExecutionError = (err: unknown): string =>
  JSON.stringify(formatToolExecutionError(err));
