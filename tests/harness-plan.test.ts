import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createRegistry, defineCapability, buildHarnessPlan } from '../src/index.js';

describe('buildHarnessPlan', () => {
  const registry = createRegistry()
    .register(
      defineCapability({
        name: 'zebra',
        description: 'z',
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
        handler: async () => ({ ok: true }),
      }),
    )
    .register(
      defineCapability({
        name: 'alpha',
        description: 'a',
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
        handler: async () => ({ ok: true }),
      }),
    );

  it('includes sorted capability names', () => {
    const plan = buildHarnessPlan(registry);
    expect(plan).toContain('alpha');
    expect(plan).toContain('zebra');
    expect(plan.indexOf('alpha')).toBeLessThan(plan.indexOf('zebra'));
  });

  it('uses custom prefix', () => {
    expect(buildHarnessPlan(registry, { prefix: 'Custom flow' })).toMatch(/^Custom flow: alpha, zebra$/);
  });
});
