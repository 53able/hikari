/**
 * 実行: npm test -- tests/exports-subpath.test.ts
 */
import { describe, it, expect } from 'vitest';

describe('package subpath exports', () => {
  it('resolves @53able/hikari/redis', async () => {
    const mod = await import('@53able/hikari/redis');
    expect(typeof mod.createRedisIdempotencyStore).toBe('function');
    expect(typeof mod.createServeRateLimitGuard).toBe('function');
  });

  it('resolves @53able/hikari/file', async () => {
    const mod = await import('@53able/hikari/file');
    expect(typeof mod.createJsonlAuditStorage).toBe('function');
    expect(typeof mod.createFileApprovalStore).toBe('function');
  });

  it('resolves @53able/hikari/hono', async () => {
    const mod = await import('@53able/hikari/hono');
    expect(typeof mod.mountHikariChat).toBe('function');
    expect(typeof mod.createHikariChatApp).toBe('function');
  });

  it('resolves @53able/hikari/pi', async () => {
    const mod = await import('@53able/hikari/pi');
    expect(typeof mod.createHikariAgent).toBe('function');
    expect(typeof mod.backendFromPiAgent).toBe('function');
  });

  it('root export does not re-export redis helpers', async () => {
    const mod = await import('@53able/hikari');
    expect('createRedisIdempotencyStore' in mod).toBe(false);
    expect('mountHikariChat' in mod).toBe(false);
    expect('createHikariAgent' in mod).toBe(false);
    expect(typeof mod.createEngine).toBe('function');
  });
});
