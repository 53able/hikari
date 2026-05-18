import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  createHeaderExecutionOptionsResolver,
  createHmacJwtExecutionOptionsResolver,
  jwtExecutionPayloadSchema,
} from '../src/web/auth.js';

const signJwt = (payload: object, secret: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
};

describe('auth resolvers', () => {
  it('falls back to cookies when readCookies is enabled', () => {
    const resolve = createHeaderExecutionOptionsResolver({ readCookies: true });
    const options = resolve(
      new Request('http://localhost/', {
        headers: {
          cookie: 'hikari-user-id=dev; hikari-permissions=admin,purchase',
        },
      }),
    );

    expect(options.userId).toBe('dev');
    expect(options.permissions).toEqual(['admin', 'purchase']);
  });

  it('prefers headers over cookies', () => {
    const resolve = createHeaderExecutionOptionsResolver({ readCookies: true });
    const options = resolve(
      new Request('http://localhost/', {
        headers: {
          'x-hikari-user-id': 'header-user',
          cookie: 'hikari-user-id=cookie-user',
        },
      }),
    );

    expect(options.userId).toBe('header-user');
  });

  it('resolves execution options from headers', () => {
    const resolve = createHeaderExecutionOptionsResolver();
    const options = resolve(
      new Request('http://localhost/', {
        headers: {
          'x-hikari-user-id': 'alice',
          'x-hikari-permissions': 'admin,read',
          'x-hikari-session-id': 'sess-1',
        },
      }),
    );

    expect(options).toEqual({
      userId: 'alice',
      permissions: ['admin', 'read'],
      sessionId: 'sess-1',
      traceId: undefined,
    });
  });

  it('validates jwt payload schema', () => {
    const parsed = jwtExecutionPayloadSchema.safeParse({ sub: 'u1', permissions: ['a'] });
    expect(parsed.success).toBe(true);
  });

  it('resolves execution options from HMAC JWT', () => {
    const secret = 'test-secret';
    const token = signJwt({ sub: 'bob', permissions: ['pay'] }, secret);
    const resolve = createHmacJwtExecutionOptionsResolver({ secret });
    const options = resolve(
      new Request('http://localhost/', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(options.userId).toBe('bob');
    expect(options.permissions).toEqual(['pay']);
  });
});
