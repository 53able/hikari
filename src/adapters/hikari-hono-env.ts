import type {
  NormalizedExecutionOptions,
} from '../core/execution.js';

/** Hono `Variables` に載せる Hikari 実行コンテキスト。 */
export type HikariHonoVariables = {
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly executionOptions: NormalizedExecutionOptions;
};

/** Hikari 実行コンテキスト用 Env。 */
export type HikariHonoEnv = {
  readonly Variables: HikariHonoVariables;
};
