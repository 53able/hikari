/**
 * 実行: npm test -- tests/llm-provider.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
  createEngine,
  createAuditLog,
  createInMemoryStorage,
  autoApprove,
  resolveLlmFromEnv,
  resolveServeChatBackend,
  missingLlmApiKeyMessage,
} from '../src/index.js';

const pingCap = defineCapability({
  name: 'ping',
  description: 'ping',
  inputSchema: z.object({}),
  outputSchema: z.object({ pong: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler() {
    return { pong: true };
  },
});

const createFixture = () => {
  const registry = createRegistry().register(pingCap);
  const auditLog = createAuditLog(createInMemoryStorage());
  const engine = createEngine({ registry, auditLog, approvalGate: autoApprove });
  return { registry, engine };
};

describe('resolveLlmFromEnv', () => {
  const envSnapshot = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    provider: process.env.LLM_PROVIDER,
  };

  afterEach(() => {
    if (envSnapshot.anthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = envSnapshot.anthropic;
    }
    if (envSnapshot.openai === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = envSnapshot.openai;
    }
    if (envSnapshot.provider === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = envSnapshot.provider;
    }
  });

  it('returns undefined when no API keys are set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_PROVIDER;
    const { registry, engine } = createFixture();
    expect(resolveLlmFromEnv(registry, engine)).toBeUndefined();
    expect(missingLlmApiKeyMessage).toContain('OPENAI_API_KEY');
  });

  it('selects anthropic when only ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_PROVIDER;
    const { registry, engine } = createFixture();
    expect(resolveLlmFromEnv(registry, engine)?.provider).toBe('anthropic');
  });

  it('selects openai when only OPENAI_API_KEY is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    delete process.env.LLM_PROVIDER;
    const { registry, engine } = createFixture();
    expect(resolveLlmFromEnv(registry, engine)?.provider).toBe('openai');
  });

  it('prefers anthropic in auto mode when both keys are set', () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    delete process.env.LLM_PROVIDER;
    const { registry, engine } = createFixture();
    expect(resolveLlmFromEnv(registry, engine)?.provider).toBe('anthropic');
  });

  it('honors LLM_PROVIDER=openai when both keys are set', () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LLM_PROVIDER = 'openai';
    const { registry, engine } = createFixture();
    expect(resolveLlmFromEnv(registry, engine)?.provider).toBe('openai');
  });
});

describe('resolveServeChatBackend', () => {
  const envSnapshot = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    provider: process.env.LLM_PROVIDER,
  };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_PROVIDER;
  });

  afterEach(() => {
    if (envSnapshot.anthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = envSnapshot.anthropic;
    }
    if (envSnapshot.openai === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = envSnapshot.openai;
    }
    if (envSnapshot.provider === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = envSnapshot.provider;
    }
  });

  it('defaults to pi backend when LLM_PROVIDER is unset', () => {
    const { registry, engine } = createFixture();
    const resolved = resolveServeChatBackend({ registry, engine });
    expect(resolved.provider).toBe('pi');
    expect(resolved.backend.stream).toBeTypeOf('function');
  });

  it('selects openai backend when LLM_PROVIDER=openai', () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LLM_PROVIDER = 'openai';
    const { registry, engine } = createFixture();
    expect(resolveServeChatBackend({ registry, engine }).provider).toBe('openai');
  });

  it('uses pi in auto mode when anthropic key is present', () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.LLM_PROVIDER = 'auto';
    const { registry, engine } = createFixture();
    expect(resolveServeChatBackend({ registry, engine }).provider).toBe('pi');
  });

  it('uses openai in auto mode when only openai key is present', () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LLM_PROVIDER = 'auto';
    const { registry, engine } = createFixture();
    expect(resolveServeChatBackend({ registry, engine }).provider).toBe('openai');
  });

  it('throws when LLM_PROVIDER=anthropic without ANTHROPIC_API_KEY', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    const { registry, engine } = createFixture();
    expect(() => resolveServeChatBackend({ registry, engine })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
