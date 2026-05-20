import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createRegistry, defineCapability } from '../src/index.js';

const makeCapability = (name: string) =>
  defineCapability({
    name,
    description: `Capability ${name}`,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
    async handler() { return {}; },
  });

describe('createRegistry', () => {
  it('registers a capability and retrieves it by name', () => {
    const registry = createRegistry();
    registry.register(makeCapability('cap_a'));
    expect(registry.get('cap_a')).toBeDefined();
    expect(registry.get('cap_a')!.name).toBe('cap_a');
  });

  it('lists all registered capability names', () => {
    const registry = createRegistry();
    registry.register(makeCapability('cap_a')).register(makeCapability('cap_b'));
    expect(registry.list()).toEqual(expect.arrayContaining(['cap_a', 'cap_b']));
    expect(registry.list()).toHaveLength(2);
  });

  it('returns undefined for unknown capability', () => {
    const registry = createRegistry();
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('throws on duplicate registration', () => {
    const registry = createRegistry();
    registry.register(makeCapability('cap_a'));
    expect(() => registry.register(makeCapability('cap_a'))).toThrow(
      "Capability 'cap_a' is already registered",
    );
  });

  it('getAll returns all capabilities', () => {
    const registry = createRegistry();
    registry.register(makeCapability('x')).register(makeCapability('y'));
    expect(registry.getAll()).toHaveLength(2);
  });

  it('register returns the registry for chaining', () => {
    const registry = createRegistry();
    const returned = registry.register(makeCapability('a'));
    expect(returned).toBe(registry);
  });

  it('listForLlm excludes capabilities with exposeToLlm false', () => {
    const hidden = defineCapability({
      name: 'hidden',
      description: 'HTTP only',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      policy: {
        requiredPermissions: [],
        sideEffects: ['read'],
        auditLevel: 'basic',
        exposeToLlm: false,
      },
      async handler() {
        return {};
      },
    });
    const registry = createRegistry();
    registry.register(makeCapability('visible')).register(hidden);
    expect(registry.listForLlm().map((c) => c.name)).toEqual(['visible']);
    expect(registry.getAll()).toHaveLength(2);
  });
});
