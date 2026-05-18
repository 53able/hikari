/**
 * 実行: npm test -- tests/auth-request.test.ts
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  createHeaderExecutionOptionsResolver,
  createHmacJwtExecutionOptionsResolver,
} from '../src/web/auth.js';

const signJwt = (payload: object, secret: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
};

describe('createHeaderExecutionOptionsResolver (Request)', () => {
  it('resolves userId from x-hikari-user-id header', () => {
    const resolve = createHeaderExecutionOptionsResolver();
    const req = new Request('http://localhost/', {
      headers: { 'x-hikari-user-id': 'alice' },
    });
    const options = resolve(req);
    expect(options.userId).toBe('alice');
  });

  it('falls back to cookies when readCookies is enabled', () => {
    const resolve = createHeaderExecutionOptionsResolver({ readCookies: true });
    const req = new Request('http://localhost/', {
      headers: {
        cookie: 'hikari-user-id=dev; hikari-permissions=admin,purchase',
      },
    });
    expect(resolve(req).userId).toBe('dev');
    expect(resolve(req).permissions).toEqual(['admin', 'purchase']);
  });

  it('prefers headers over cookies', () => {
    const resolve = createHeaderExecutionOptionsResolver({ readCookies: true });
    const req = new Request('http://localhost/', {
      headers: {
        'x-hikari-user-id': 'header-user',
        cookie: 'hikari-user-id=cookie-user',
      },
    });
    expect(resolve(req).userId).toBe('header-user');
  });
});

describe('createHmacJwtExecutionOptionsResolver (Request)', () => {
  it('resolves execution options from Bearer JWT', () => {
    const secret = 'test-secret';
    const token = signJwt({ sub: 'bob', permissions: ['pay'] }, secret);
    const resolve = createHmacJwtExecutionOptionsResolver({ secret });
    const req = new Request('http://localhost/', {
      headers: { authorization: `Bearer ${token}` },
    });
    const options = resolve(req);
    expect(options.userId).toBe('bob');
    expect(options.permissions).toEqual(['pay']);
  });
});
