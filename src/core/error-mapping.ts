import { ApprovalDeniedError } from './approval.js';
import {
  CapabilityNotFoundError,
  IdempotencyConflictError,
  IdempotencyRequiredError,
  ValidationError,
} from './execution.js';
import { PolicyViolationError } from './policy.js';
import { FormBodyParseError } from '../web/cap-form-schema.js';
import type { ToolExecutionErrorPayload } from './tool-error.js';

/** HTTP / LLM 双方に適用する実行エラーの解決結果。 */
export type ResolvedExecutionError = {
  readonly httpStatus: number;
  readonly httpBody: { error: { code: string; message: string; issues?: unknown } };
  readonly toolPayload: ToolExecutionErrorPayload;
};

const resolveUnknown = (err: unknown): ResolvedExecutionError => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  return {
    httpStatus: 500,
    httpBody: { error: { code: 'INTERNAL_ERROR', message } },
    toolPayload: { code: 'execution_error', message, retryable: false },
  };
};

/**
 * エンジン実行エラーを HTTP 応答と LLM ツールペイロードに同時マッピングする。
 */
export const resolveExecutionError = (err: unknown): ResolvedExecutionError => {
  if (err instanceof CapabilityNotFoundError) {
    return {
      httpStatus: 404,
      httpBody: { error: { code: 'NOT_FOUND', message: err.message } },
      toolPayload: {
        code: 'capability_not_found',
        message: err.message,
        retryable: false,
      },
    };
  }
  if (err instanceof ValidationError) {
    const toolCode =
      err.phase === 'output' ? 'output_validation_error' : 'validation_error';
    return {
      httpStatus: 400,
      httpBody: {
        error: {
          code: 'VALIDATION_ERROR',
          message: err.message,
          issues: err.issues,
        },
      },
      toolPayload: { code: toolCode, message: err.message, retryable: false },
    };
  }
  if (err instanceof FormBodyParseError) {
    return {
      httpStatus: 400,
      httpBody: { error: { code: 'VALIDATION_ERROR', message: err.message } },
      toolPayload: { code: 'validation_error', message: err.message, retryable: false },
    };
  }
  if (err instanceof PolicyViolationError) {
    return {
      httpStatus: 403,
      httpBody: { error: { code: 'FORBIDDEN', message: err.message } },
      toolPayload: { code: 'policy_denied', message: err.message, retryable: false },
    };
  }
  if (err instanceof ApprovalDeniedError) {
    return {
      httpStatus: 409,
      httpBody: { error: { code: 'APPROVAL_DENIED', message: err.message } },
      toolPayload: { code: 'approval_denied', message: err.message, retryable: false },
    };
  }
  if (err instanceof IdempotencyConflictError) {
    return {
      httpStatus: 409,
      httpBody: { error: { code: 'IDEMPOTENCY_CONFLICT', message: err.message } },
      toolPayload: {
        code: 'idempotency_conflict',
        message: err.message,
        retryable: false,
      },
    };
  }
  if (err instanceof IdempotencyRequiredError) {
    return {
      httpStatus: 400,
      httpBody: { error: { code: 'IDEMPOTENCY_REQUIRED', message: err.message } },
      toolPayload: {
        code: 'idempotency_required',
        message: err.message,
        retryable: false,
      },
    };
  }
  return resolveUnknown(err);
};
