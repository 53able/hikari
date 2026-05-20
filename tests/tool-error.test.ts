import { describe, it, expect } from 'vitest';
import {
  formatToolExecutionError,
  serializeToolExecutionError,
  toolExecutionErrorPayloadSchema,
} from '../src/core/tool-error.js';
import {
  ValidationError,
  CapabilityNotFoundError,
  IdempotencyConflictError,
} from '../src/core/execution.js';
import { PolicyViolationError } from '../src/core/policy.js';
import { ApprovalDeniedError } from '../src/core/approval.js';

describe('formatToolExecutionError', () => {
  it('maps ValidationError input phase', () => {
    const err = new ValidationError(
      [{ message: 'Required', path: ['value'] }],
      'echo',
      'input',
    );
    expect(formatToolExecutionError(err)).toEqual({
      code: 'validation_error',
      message: "Input validation failed for 'echo'",
      retryable: false,
    });
  });

  it('maps ValidationError output phase', () => {
    const err = new ValidationError([], 'echo', 'output');
    expect(formatToolExecutionError(err).code).toBe('output_validation_error');
  });

  it('maps PolicyViolationError', () => {
    const err = new PolicyViolationError('Missing permission', 'protected');
    expect(formatToolExecutionError(err).code).toBe('policy_denied');
  });

  it('maps ApprovalDeniedError', () => {
    const err = new ApprovalDeniedError('req-1', 'pay', 'no');
    expect(formatToolExecutionError(err).code).toBe('approval_denied');
  });

  it('maps IdempotencyConflictError', () => {
    const err = new IdempotencyConflictError('key-1');
    expect(formatToolExecutionError(err).code).toBe('idempotency_conflict');
  });

  it('maps CapabilityNotFoundError', () => {
    const err = new CapabilityNotFoundError('missing');
    expect(formatToolExecutionError(err).code).toBe('capability_not_found');
  });

  it('maps unknown errors to execution_error', () => {
    expect(formatToolExecutionError(new Error('boom')).code).toBe('execution_error');
  });

  it('serializeToolExecutionError parses with schema', () => {
    const json = serializeToolExecutionError(new Error('x'));
    expect(toolExecutionErrorPayloadSchema.parse(JSON.parse(json))).toMatchObject({
      code: 'execution_error',
      retryable: false,
    });
  });
});
