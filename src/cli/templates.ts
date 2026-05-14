export interface CapabilityTemplateVars {
  name: string;
  pascalName: string;
  sideEffects: string;
  requiredPermissions: string;
  auditLevel: 'none' | 'basic' | 'full';
}

export function toPascalCase(name: string): string {
  return name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export function renderCapabilityTemplate(vars: CapabilityTemplateVars): string {
  return `import { z } from 'zod';
import { defineCapability } from 'hikari';

export const ${vars.name} = defineCapability({
  name: '${vars.name}',
  description: 'TODO: describe what ${vars.name} does',
  inputSchema: z.object({
    // TODO: define input fields
  }),
  outputSchema: z.object({
    // TODO: define output fields
  }),
  policy: {
    requiredPermissions: ${vars.requiredPermissions},
    sideEffects: ${vars.sideEffects},
    auditLevel: '${vars.auditLevel}',
  },
  async handler(_input, _context) {
    // TODO: implement handler
    throw new Error('Not implemented');
  },
});
`;
}

export function renderTestTemplate(vars: { name: string; importPath: string }): string {
  return `import { describe, it, expect } from 'vitest';
import { createEngine, createRegistry, createAuditLog, createInMemoryStorage, autoApprove } from 'hikari';
import { ${vars.name} } from '${vars.importPath}';

describe('${vars.name}', () => {
  const storage = createInMemoryStorage();
  const auditLog = createAuditLog(storage);
  const registry = createRegistry().register(${vars.name});
  const engine = createEngine({ registry, auditLog, approvalGate: autoApprove });

  const ctx = { userId: 'test-user', permissions: [] };

  it('executes successfully', async () => {
    // TODO: provide valid input
    const result = await engine.execute('${vars.name}', {}, ctx);
    expect(result.success).toBe(true);
  });

  it('records audit trail', async () => {
    await engine.execute('${vars.name}', {}, ctx);
    const entries = storage.getAll();
    expect(entries.some((e) => e.capabilityName === '${vars.name}')).toBe(true);
  });
});
`;
}
