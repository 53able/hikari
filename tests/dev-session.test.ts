import { describe, it, expect } from 'vitest';
import { parseDevSessionFormBody } from '../src/web/dev-session.js';

describe('parseDevSessionFormBody', () => {
  it('parses urlencoded dev session form', () => {
    const parsed = parseDevSessionFormBody(
      'userId=alice&permissions=admin%2Cpurchase',
      'application/x-www-form-urlencoded',
    );
    expect(parsed).toEqual({ userId: 'alice', permissions: 'admin,purchase' });
  });

  it('returns error when userId missing', () => {
    const parsed = parseDevSessionFormBody(
      'permissions=admin',
      'application/x-www-form-urlencoded',
    );
    expect(parsed).toEqual({ error: 'userId is required' });
  });
});
