import { describe, it, expect } from 'vitest';
import { needsHumanApproval, policy } from '../src/core/policy.js';
import type { Policy } from '../src/core/capability.js';

const basePolicy = (overrides: Partial<Policy> = {}): Policy => ({
  requiredPermissions: [],
  sideEffects: ['read'],
  auditLevel: 'basic',
  ...overrides,
});

describe('needsHumanApproval', () => {
  it('requires approval for financial side effects', () => {
    expect(needsHumanApproval(basePolicy({ sideEffects: ['financial'] }))).toBe(true);
  });

  it('requires approval when requiresApprovalWhen matches input', () => {
    const p = basePolicy({
      sideEffects: ['write'],
      requiresApprovalWhen: (input: { amount: number }) => input.amount > 100_000,
    });
    expect(needsHumanApproval(p, { amount: 50_000 })).toBe(false);
    expect(needsHumanApproval(p, { amount: 200_000 })).toBe(true);
  });

  it('does not require approval for read-only without predicate', () => {
    expect(needsHumanApproval(basePolicy())).toBe(false);
  });
});

describe('policy helpers', () => {
  it('policy.role sets requiredPermissions', () => {
    expect(policy.role('admin').requiredPermissions).toEqual(['admin']);
  });
});
