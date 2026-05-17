import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
  exportOpenApiDocument,
} from '../src/index.js';

const echo = defineCapability({
  name: 'echo',
  description: 'Echo input',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ value: z.string() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  handler: async ({ value }) => ({ value }),
});

describe('exportOpenApiDocument', () => {
  it('builds OpenAPI 3 paths from registry meta', () => {
    const registry = createRegistry().register(echo);
    const doc = exportOpenApiDocument(registry, { basePath: '/api' });

    expect(doc.openapi).toBe('3.0.3');
    expect(doc.paths['/api/capabilities']).toBeDefined();
    expect(doc.paths['/api/capabilities/echo']).toBeDefined();
    expect(doc.components?.schemas?.echoInput).toBeDefined();
    expect(doc.components?.schemas?.echoOutput).toBeDefined();
  });
});
