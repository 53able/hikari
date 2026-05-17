import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
  createCapabilityExplorer,
} from '../src/index.js';

const sample = defineCapability({
  name: 'sample_read',
  description: 'Sample read capability',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler() {
    return {};
  },
});

describe('createCapabilityExplorer', () => {
  const registry = createRegistry().register(sample);
  const explorer = createCapabilityExplorer(registry);

  it('lists meta from registry', () => {
    const meta = explorer.listMeta();
    expect(meta).toHaveLength(1);
    expect(meta[0]?.name).toBe('sample_read');
  });

  it('formats text manifest', () => {
    const text = explorer.formatText();
    expect(text).toContain('sample_read');
    expect(text).toContain('Sample read');
  });

  it('renders HTML explorer page', () => {
    const html = explorer.renderHtml();
    expect(html).toContain('<title>Hikari Capability Explorer</title>');
    expect(html).toContain('sample_read');
  });
});
