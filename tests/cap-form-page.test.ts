import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createRegistry, defineCapability, buildCapabilityMeta } from '../src/index.js';
import { fieldsFromInputSchema } from '../src/web/cap-form-schema.js';
import { renderCapabilityFormHtml } from '../src/web/cap-form-page.js';

const demoCap = defineCapability({
  name: 'demo_form_cap',
  description: 'Demo capability for form rendering',
  inputSchema: z.object({
    title: z.string().describe('Book title'),
    quantity: z.number().int().min(1),
    tone: z.enum(['polite', 'firm']).optional(),
    notify: z.boolean().optional(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  handler: async () => ({ ok: true }),
});

describe('fieldsFromInputSchema', () => {
  it('extracts required flags and types from OpenAPI JSON schema', () => {
    const meta = buildCapabilityMeta(demoCap);
    const fields = fieldsFromInputSchema(meta.inputSchema);
    const title = fields.find((f) => f.name === 'title');
    const quantity = fields.find((f) => f.name === 'quantity');
    const tone = fields.find((f) => f.name === 'tone');
    expect(title?.required).toBe(true);
    expect(title?.type).toBe('string');
    expect(quantity?.type).toBe('integer');
    expect(tone?.enumValues).toEqual(['polite', 'firm']);
  });
});

describe('renderCapabilityFormHtml', () => {
  it('renders semantic HTML form with action URL', () => {
    const registry = createRegistry().register(demoCap);
    const meta = buildCapabilityMeta(registry.get('demo_form_cap')!);
    const html = renderCapabilityFormHtml(meta, {
      actionUrl: '/api/capabilities/demo_form_cap',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="quantity"');
    expect(html).toContain('action="/api/capabilities/demo_form_cap"');
    expect(html).toContain('Demo capability for form rendering');
  });
});
