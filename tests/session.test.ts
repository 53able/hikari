import { describe, it, expect, vi } from 'vitest';
import { createSessionManager } from '../src/agent/session.js';

describe('createSessionManager', () => {
  it('creates and retrieves a session', () => {
    const mgr = createSessionManager();
    const session = mgr.createSession('alice');
    expect(session.userId).toBe('alice');
    expect(mgr.getSession(session.id)).toBe(session);
  });

  it('appends messages and respects maxMessages cap', () => {
    const mgr = createSessionManager({ maxMessagesPerSession: 3 });
    const s = mgr.createSession('bob');
    mgr.appendMessage(s.id, { role: 'user', content: 'a' });
    mgr.appendMessage(s.id, { role: 'user', content: 'b' });
    mgr.appendMessage(s.id, { role: 'user', content: 'c' });
    mgr.appendMessage(s.id, { role: 'user', content: 'd' }); // evicts 'a'
    const msgs = mgr.getMessages(s.id);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].content).toBe('b');
    expect(msgs[2].content).toBe('d');
  });

  it('lists sessions by userId', () => {
    const mgr = createSessionManager();
    mgr.createSession('alice');
    mgr.createSession('alice');
    mgr.createSession('bob');
    expect(mgr.listUserSessions('alice')).toHaveLength(2);
    expect(mgr.listUserSessions('bob')).toHaveLength(1);
  });

  it('deletes a session', () => {
    const mgr = createSessionManager();
    const s = mgr.createSession('alice');
    expect(mgr.deleteSession(s.id)).toBe(true);
    expect(mgr.getSession(s.id)).toBeUndefined();
  });

  it('sweeps idle sessions', () => {
    let tick = 0;
    const mgr = createSessionManager({ idleTtlMs: 1000, now: () => new Date(tick) });
    const s = mgr.createSession('alice');
    tick = 2000; // past TTL
    const swept = mgr.sweepIdle();
    expect(swept).toBe(1);
    expect(mgr.getSession(s.id)).toBeUndefined();
  });

  it('throws on appendMessage to unknown session', () => {
    const mgr = createSessionManager();
    expect(() => mgr.appendMessage('no-such-id', { role: 'user', content: 'x' })).toThrow();
  });
});
