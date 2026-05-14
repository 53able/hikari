import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCapability } from '../src/index.js';

describe('defineCapability', () => {
  it('returns the definition unchanged', () => {
    const cap = defineCapability({
      name: 'echo',
      description: 'Echo back the input',
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
      async handler({ value }) {
        return { result: value };
      },
    });

    expect(cap.name).toBe('echo');
    expect(cap.description).toBe('Echo back the input');
    expect(cap.policy.sideEffects).toContain('read');
    expect(cap.policy.auditLevel).toBe('basic');
  });

  it('validates input with inputSchema', () => {
    const cap = defineCapability({
      name: 'typed',
      description: 'Typed input',
      inputSchema: z.object({ age: z.number().int().positive() }),
      outputSchema: z.object({}),
      policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'none' },
      async handler() { return {}; },
    });

    expect(cap.inputSchema.safeParse({ age: 25 }).success).toBe(true);
    expect(cap.inputSchema.safeParse({ age: -1 }).success).toBe(false);
    expect(cap.inputSchema.safeParse({ age: 'hello' }).success).toBe(false);
  });
});
