import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
  buildHarnessPlan,
  buildHarnessPlanFromToolCalls,
  harnessPlanStepsMetadata,
} from '../src/index.js';

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

describe('buildHarnessPlanFromToolCalls', () => {
  it('builds ordered human-readable plan from tool steps', () => {
    const plan = buildHarnessPlanFromToolCalls(
      [
        { capabilityName: 'purchase_book', order: 1, toolCallId: 'c2' },
        { capabilityName: 'list_books', order: 0, toolCallId: 'c1' },
      ],
      { prefix: 'Bookstore flow' },
    );
    expect(plan).toBe('Bookstore flow: 1. list_books; 2. purchase_book');
  });

  it('embeds structured steps in metadata', () => {
    const steps = [{ capabilityName: 'echo', order: 0, toolCallId: 't1' }];
    expect(harnessPlanStepsMetadata(steps)).toEqual({
      planSteps: [{ capabilityName: 'echo', order: 0, toolCallId: 't1' }],
    });
  });
});
