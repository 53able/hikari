import type { HikariRedis } from '../../src/core/redis-client.js';

type ZMember = { readonly score: number; readonly value: string };

/**
 * ユニットテスト用のインメモリ Redis フェイク。
 * 本番 Redis サーバーなしでストア実装を検証する。
 */
export const createFakeRedis = (): HikariRedis => {
  const strings = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const lists = new Map<string, string[]>();

  const zset = (key: string): Map<string, number> => {
    const existing = zsets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    zsets.set(key, created);
    return created;
  };

  const list = (key: string): string[] => {
    const existing = lists.get(key);
    if (existing) return existing;
    const created: string[] = [];
    lists.set(key, created);
    return created;
  };

  return {
    get: async (key) => strings.get(key) ?? null,
    set: async (key, value, options) => {
      if (options?.NX && strings.has(key)) return null;
      strings.set(key, value);
      return 'OK';
    },
    del: async (...keys) => {
      let count = 0;
      for (const key of keys) {
        if (strings.delete(key)) count += 1;
        if (zsets.delete(key)) count += 1;
        if (lists.delete(key)) count += 1;
      }
      return count;
    },
    zAdd: async (key, members) => {
      const set = zset(key);
      for (const m of members) {
        set.set(m.value, m.score);
      }
      return members.length;
    },
    zRem: async (key, member) => {
      const removed = zset(key).delete(member) ? 1 : 0;
      return removed;
    },
    zRangeByScore: async (key, min, max, options) => {
      const set = zset(key);
      const minScore = min === '-inf' ? -Infinity : Number(min);
      const maxScore = max === '+inf' ? Infinity : Number(max);
      const entries: ZMember[] = [...set.entries()].map(([value, score]) => ({ value, score }));
      const filtered = entries.filter((e) => e.score >= minScore && e.score <= maxScore);
      filtered.sort((a, b) => (options?.REV ? b.score - a.score : a.score - b.score));
      return filtered.map((e) => e.value);
    },
    zRemRangeByScore: async (key, min, max) => {
      const set = zset(key);
      const minScore = Number(min);
      const maxScore = Number(max);
      let removed = 0;
      for (const [value, score] of [...set.entries()]) {
        if (score >= minScore && score <= maxScore) {
          set.delete(value);
          removed += 1;
        }
      }
      return removed;
    },
    zCard: async (key) => zset(key).size,
    lPush: async (key, value) => {
      list(key).unshift(value);
      return list(key).length;
    },
    brPop: async (key, timeoutSeconds) => {
      const end = Date.now() + timeoutSeconds * 1000;
      while (Date.now() < end) {
        const items = list(key);
        if (items.length > 0) {
          const element = items.pop();
          if (element !== undefined) {
            return { key, element };
          }
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      return null;
    },
    evalScript: async () => 0,
    ping: async () => 'PONG',
  };
};
