import type { Env, Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import {
  normalizeExecutionOptions,
  type ExecutionOptions,
} from '../core/execution.js';
import type { HttpAdapter } from './http.js';
import type { HikariHonoEnv } from './hikari-hono-env.js';

/** `mountHikariHttpAdapter` のオプション。 */
export type MountHikariHttpAdapterOptions = {
  /** HTTP アダプタのベースパス（`createHttpAdapter` の `basePath` と一致させる）。デフォルト: `/api`。 */
  readonly basePath?: string;
};

/**
 * リクエストから `ExecutionOptions` を解決し Hono `Variables` に載せるミドルウェア。
 */
export const createHikariExecutionOptionsMiddleware = (
  resolveExecutionOptions: (
    req: Request,
  ) => ExecutionOptions | Promise<ExecutionOptions>,
): MiddlewareHandler<HikariHonoEnv> =>
  async (c, next) => {
    const exec = normalizeExecutionOptions(
      await Promise.resolve(resolveExecutionOptions(c.req.raw)),
    );
    c.set('userId', exec.userId);
    c.set('permissions', exec.permissions);
    c.set('executionOptions', exec);
    await next();
  };

/**
 * `createHttpAdapter` を Hono ルートとしてマウントする。
 */
export const createHikariHttpMiddleware = (
  httpAdapter: HttpAdapter,
): MiddlewareHandler =>
  async (c) => {
    const response = await httpAdapter.fetch(c.req.raw);
    if (response) {
      return response;
    }
    return c.notFound();
  };

/**
 * Hono アプリに Hikari REST ルートを登録する。
 */
export const mountHikariHttpAdapter = <E extends Env = Env>(
  app: Hono<E>,
  httpAdapter: HttpAdapter,
  options: MountHikariHttpAdapterOptions = {},
): Hono<E> => {
  const basePath = options.basePath ?? '/api';
  const middleware = createHikariHttpMiddleware(httpAdapter);
  return app
    .all(`${basePath}/capabilities`, middleware)
    .all(`${basePath}/capabilities/*`, middleware)
    .all(`${basePath}/openapi.json`, middleware);
};
