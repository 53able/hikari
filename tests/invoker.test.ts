import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
  createCapabilityInvoker,
  parseInvokeCliArgs,
  formatInvokeReport,
} from '../src/index.js';

const echo = defineCapability({
  name: 'echo',
  description: 'Echo input',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler({ value }) {
    return { result: value.toUpperCase() };
  },
});

const adminOnly = defineCapability({
  name: 'admin_only',
  description: 'Requires admin',
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  policy: { requiredPermissions: ['admin'], sideEffects: ['read'], auditLevel: 'basic' },
  async handler() {
    return { ok: true };
  },
});

const writeCap = defineCapability({
  name: 'write_cap',
  description: 'Write side effect',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  policy: { requiredPermissions: [], sideEffects: ['write'], auditLevel: 'basic' },
  async handler({ value }) {
    return { result: value };
  },
});

describe('createCapabilityInvoker', () => {
  const registry = createRegistry()
    .register(echo)
    .register(adminOnly)
    .register(writeCap);
  const invoker = createCapabilityInvoker({ registry, userId: 'tester' });

  it('lists capability names', () => {
    expect(invoker.listCapabilityNames()).toEqual(['echo', 'admin_only', 'write_cap']);
  });

  it('formats capability list as text', () => {
    const text = invoker.formatCapabilityList();
    expect(text).toContain('echo');
    expect(text).toContain('admin_only');
  });

  it('invokes a capability successfully', async () => {
    const report = await invoker.invoke({
      capabilityName: 'echo',
      input: { value: 'hi' },
      userId: 'tester',
      permissions: [],
    });
    expect(report.ok).toBe(true);
    expect(report.result?.output).toEqual({ result: 'HI' });
    expect(report.auditEntryCount).toBeGreaterThan(0);
  });

  it('returns structured error for unknown capability', async () => {
    const report = await invoker.invoke({
      capabilityName: 'missing',
      input: {},
      userId: 'tester',
      permissions: [],
    });
    expect(report.ok).toBe(false);
    expect(report.error?.name).toBe('CapabilityNotFoundError');
  });

  it('returns structured error for policy violation', async () => {
    const report = await invoker.invoke({
      capabilityName: 'admin_only',
      input: {},
      userId: 'tester',
      permissions: [],
    });
    expect(report.ok).toBe(false);
    expect(report.error?.name).toBe('PolicyViolationError');
  });

  it('auto-assigns idempotencyKey for write capabilities', async () => {
    const report = await invoker.invoke({
      capabilityName: 'write_cap',
      input: { value: 'persist' },
      userId: 'tester',
      permissions: [],
    });
    expect(report.ok).toBe(true);
    expect(report.error?.name).not.toBe('IdempotencyRequiredError');
    expect(report.result?.output).toEqual({ result: 'persist' });
  });

  it('uses explicit idempotencyKey when provided', async () => {
    const report = await invoker.invoke({
      capabilityName: 'write_cap',
      input: { value: 'fixed' },
      userId: 'tester',
      permissions: [],
      idempotencyKey: 'manual-invoke-key',
    });
    expect(report.ok).toBe(true);
  });
});

describe('parseInvokeCliArgs', () => {
  it('parses list mode', () => {
    expect(parseInvokeCliArgs(['--list'])).toEqual({ mode: 'list' });
  });

  it('parses invoke positional args', () => {
    const parsed = parseInvokeCliArgs(['echo', '{"value":"x"}', 'admin']);
    expect(parsed).toEqual({
      mode: 'invoke',
      capabilityName: 'echo',
      input: { value: 'x' },
      permissions: ['admin'],
    });
  });

  it('uses defaults when argv is empty', () => {
    const parsed = parseInvokeCliArgs([], { capabilityName: 'echo', inputJson: '{"value":"d"}' });
    expect(parsed).toMatchObject({
      mode: 'invoke',
      capabilityName: 'echo',
      input: { value: 'd' },
    });
  });
});

describe('formatInvokeReport', () => {
  it('serializes report as JSON', () => {
    const json = formatInvokeReport({
      ok: true,
      capability: 'echo',
      result: { success: true, output: { result: 'A' }, traceId: 't1' },
      auditEntryCount: 2,
    });
    expect(JSON.parse(json)).toMatchObject({ ok: true, capability: 'echo' });
  });
});
