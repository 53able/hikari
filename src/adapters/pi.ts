import type { CapabilityRuntime } from '../core/capability.js';
import type { Engine } from '../core/execution.js';
import { createEngine } from '../core/execution.js';
import type { AuditLogger } from '../core/audit.js';
import type { ApprovalGate } from '../core/approval.js';
import type { IdempotencyStore } from '../core/idempotency-store.js';
import type { Registry } from '../core/registry.js';
import { createHarnessTracer, type HarnessTracer } from '../core/harness-trace.js';
import type {
  HikariAgent,
  HikariAgentOptions,
  PiToolExecutionContext,
} from './pi-agent.js';
import { createHikariAgent } from './pi-agent.js';
import { runPiAgentTurn, type PiTurnHistoryMessage } from './pi-turn.js';

export type {
  HikariAgent,
  HikariAgentOptions,
  PiToolBindings,
  PiToolExecutionContext,
  PiToolResultDetails,
} from './pi-agent.js';
export {
  createHikariAgent,
  createHikariAgentWithOptions,
  toAgentTools,
  chatHistoryToAgentMessages,
  intentSnippetFromMessage,
  traceIdFromPiToolResult,
  trimAgentMessagesForContext,
} from './pi-agent.js';
export type { ResolvedPiModel } from './pi-model.js';
export { resolvePiModelFromEnv, resolvePiGetApiKey, resolveAgentPromptFromEnv } from './pi-model.js';
export type { RunPiAgentTurnInput, RunPiAgentTurnResult, PiTurnHistoryMessage } from './pi-turn.js';
export { runPiAgentTurn, streamPiAgentTurn } from './pi-turn.js';

/** `createHikariHarness` の依存関係。 */
export type HikariHarnessDeps = {
  readonly registry: Registry;
  readonly auditLog: AuditLogger;
  readonly approvalGate?: ApprovalGate;
  readonly idempotencyStore?: IdempotencyStore;
  readonly runtime?: CapabilityRuntime;
  readonly agentOptions?: HikariAgentOptions;
  readonly planPrefix?: string;
};

/** Pi harness + Hikari engine を束ねた実行面。 */
export type HikariHarness = {
  /** 直近ターンで使用した Agent（主にデバッグ・購読用）。 */
  readonly agent: HikariAgent;
  readonly harness: HarnessTracer;
  readonly engine: Engine;
  readonly runTurn: (input: {
    readonly message: string;
    readonly context: PiToolExecutionContext;
    readonly history?: readonly PiTurnHistoryMessage[];
    readonly onAgentReady?: (agent: HikariAgent) => void;
  }) => Promise<{ readonly traceId: string }>;
};

/**
 * Pi Agent と Hikari engine を統合する harness 層。
 */
export const createHikariHarness = (deps: HikariHarnessDeps): HikariHarness => {
  const harness = createHarnessTracer(deps.auditLog, { registry: deps.registry });
  const engine = createEngine({
    registry: deps.registry,
    auditLog: deps.auditLog,
    approvalGate: deps.approvalGate,
    idempotencyStore: deps.idempotencyStore,
    runtime: deps.runtime,
    harness,
    harnessMode: 'tool-only',
  });

  const placeholderAgent = createHikariAgent(deps.registry, engine, () => ({
    userId: 'anonymous',
  }), { ...deps.agentOptions, harness: undefined });

  const lastAgentRef: { current: HikariAgent } = { current: placeholderAgent };

  const runTurn = async (input: {
    message: string;
    context: PiToolExecutionContext;
    history?: readonly PiTurnHistoryMessage[];
    onAgentReady?: (agent: HikariAgent) => void;
  }): Promise<{ traceId: string }> => {
    const result = await runPiAgentTurn({
      registry: deps.registry,
      engine,
      message: input.message,
      context: input.context,
      history: input.history,
      harness,
      planPrefix: deps.planPrefix,
      agentOptions: deps.agentOptions,
      onAgentReady: (agent) => {
        lastAgentRef.current = agent;
        input.onAgentReady?.(agent);
      },
    });
    return { traceId: result.traceId };
  };

  return {
    get agent() {
      return lastAgentRef.current;
    },
    harness,
    engine,
    runTurn,
  };
};
