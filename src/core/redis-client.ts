import { createClient, type RedisClientType } from 'redis';

/** `createHikariRedisClient` が利用する Redis コマンドの最小集合（テスト用フェイク実装向け）。 */
export type HikariRedis = {
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (
    key: string,
    value: string,
    options?: { readonly EX?: number; readonly NX?: boolean },
  ) => Promise<string | null>;
  readonly del: (...keys: string[]) => Promise<number>;
  readonly zAdd: (
    key: string,
    members: ReadonlyArray<{ readonly score: number; readonly value: string }>,
  ) => Promise<number>;
  readonly zRem: (key: string, member: string) => Promise<number>;
  readonly zRangeByScore: (
    key: string,
    min: number | string,
    max: number | string,
    options?: { readonly REV?: boolean },
  ) => Promise<readonly string[]>;
  readonly zRemRangeByScore: (
    key: string,
    min: number | string,
    max: number | string,
  ) => Promise<number>;
  readonly zCard: (key: string) => Promise<number>;
  readonly lPush: (key: string, value: string) => Promise<number>;
  readonly brPop: (
    key: string,
    timeoutSeconds: number,
  ) => Promise<{ readonly key: string; readonly element: string } | null>;
  readonly evalScript: (
    script: string,
    keys: readonly string[],
    args: readonly string[],
  ) => Promise<unknown>;
  readonly ping: () => Promise<string>;
};

/** `connectHikariRedis` のオプション。 */
export type ConnectHikariRedisOptions = {
  /** 接続 URL。省略時は `REDIS_URL` または `redis://127.0.0.1:6379`。 */
  readonly url?: string;
  /** 接続失敗時のメッセージ接頭辞（CLI 向け）。 */
  readonly label?: string;
};

const defaultRedisUrl = (): string =>
  process.env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379';

const wrapClient = (client: RedisClientType): HikariRedis => ({
  get: (key) => client.get(key),
  set: async (key, value, options) => {
    if (options?.NX && options.EX !== undefined) {
      return client.set(key, value, { NX: true, EX: options.EX });
    }
    if (options?.NX) {
      return client.set(key, value, { NX: true });
    }
    if (options?.EX !== undefined) {
      return client.set(key, value, { EX: options.EX });
    }
    return client.set(key, value);
  },
  del: (...keys) => client.del(keys),
  zAdd: (key, members) =>
    client.zAdd(
      key,
      members.map((m) => ({ score: m.score, value: m.value })),
    ),
  zRem: (key, member) => client.zRem(key, member),
  zRangeByScore: (key, min, max, options) => {
    const zRangeByScoreCmd = client.zRangeByScore.bind(client) as (
      rangeKey: string,
      rangeMin: string | number,
      rangeMax: string | number,
      rangeOptions?: { readonly REV?: true },
    ) => Promise<string[]>;
    return options?.REV
      ? zRangeByScoreCmd(key, min, max, { REV: true })
      : zRangeByScoreCmd(key, min, max);
  },
  zRemRangeByScore: (key, min, max) => client.zRemRangeByScore(key, min, max),
  zCard: (key) => client.zCard(key),
  lPush: (key, value) => client.lPush(key, value),
  brPop: async (key, timeoutSeconds) => {
    const result = await client.brPop(key, timeoutSeconds);
    if (!result) return null;
    return { key: result.key, element: result.element };
  },
  evalScript: (script, keys, args) => client.eval(script, { keys: [...keys], arguments: [...args] }),
  ping: () => client.ping(),
});

/**
 * `redis` パッケージのクライアントを Hikari 向け薄ラッパに包む。
 * `connect()` は呼び出し側（`connectHikariRedis`）の責務。
 */
export const createHikariRedisClient = (url?: string): { readonly redis: HikariRedis; readonly disconnect: () => Promise<void> } => {
  const resolvedUrl = url?.trim() || defaultRedisUrl();
  const client = createClient({ url: resolvedUrl }) as RedisClientType;
  const redis = wrapClient(client);
  return {
    redis,
    disconnect: async () => {
      if (client.isOpen) {
        await client.quit();
      }
    },
  };
};

/**
 * Redis へ接続し、利用可能な `HikariRedis` を返す。
 * 接続失敗時は分かりやすいエラーメッセージで reject する。
 */
export const connectHikariRedis = async (
  options: ConnectHikariRedisOptions = {},
): Promise<{ readonly redis: HikariRedis; readonly disconnect: () => Promise<void> }> => {
  const label = options.label ?? 'Redis';
  const url = options.url?.trim() || defaultRedisUrl();
  const client = createClient({ url }) as RedisClientType;

  client.on('error', (err) => {
    console.error(`[hikari] ${label} client error:`, err instanceof Error ? err.message : String(err));
  });

  try {
    await client.connect();
    await client.ping();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${label} unavailable at ${url}. Start Redis or omit --*-redis flags. (${detail})`,
    );
  }

  return {
    redis: wrapClient(client),
    disconnect: async () => {
      if (client.isOpen) {
        await client.quit();
      }
    },
  };
};

/** デフォルトの `REDIS_URL`（ドキュメント・CLI 向け）。 */
export const resolveRedisUrl = (override?: string): string =>
  override?.trim() || defaultRedisUrl();
