import { randomUUID } from 'crypto';
import type { Capability, ExecutionContext } from './capability.js';
import type { AuditLogger } from './audit.js';
import {
  evaluatePolicy,
  describeRisk,
  PolicyViolationError,
  resolveEffectivePolicy,
  type EffectivePolicy,
} from './policy.js';
import type { CapabilityRuntime } from './capability.js';
import type { ApprovalGate } from './approval.js';
import { ApprovalDeniedError } from './approval.js';
import type { Registry } from './registry.js';
import type { HarnessTracer } from './harness-trace.js';
import { buildHarnessPlan } from './harness-plan.js';
import { scrubAuditPayload } from './audit-scrub.js';
import type { IdempotencyStore } from './idempotency-store.js';
import {
  buildIdempotencyStoreKey,
  hashCapabilityInput,
} from './idempotency-store.js';
import type { ExecutionOptions, ExecutionResult, HarnessMode } from './execution.js';
import { CapabilityNotFoundError } from './execution.js';
import { IdempotencyConflictError } from './execution.js';
import { IdempotencyRequiredError } from './execution.js';
import { ValidationError } from './execution.js';

/** `runCapabilityPipeline` の依存関係。 */
export type CapabilityPipelineConfig = {
  readonly registry: Registry;
  readonly auditLog: AuditLogger;
  readonly approvalGate?: ApprovalGate;
  readonly idempotencyStore?: IdempotencyStore;
  readonly runtime?: CapabilityRuntime;
  readonly harness?: HarnessTracer;
  readonly harnessMode?: HarnessMode;
};

type AuditPayload = {
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
};

type PipelineLookup = {
  readonly capability: Capability;
  readonly capabilityName: string;
  readonly basePolicy: EffectivePolicy;
};

type PipelineContext = PipelineLookup & {
  readonly options: ExecutionOptions;
  readonly inputHash: string;
  readonly context: ExecutionContext;
};

type PipelineValidated = PipelineContext & {
  readonly parsedInput: unknown;
  readonly effectivePolicy: EffectivePolicy;
};

const recordAudit = async (
  auditLog: AuditLogger,
  capability: Capability,
  type: Parameters<AuditLogger['record']>[0],
  capabilityName: string,
  context: ExecutionContext,
  auditLevel: Capability['policy']['auditLevel'],
  data?: AuditPayload,
): Promise<void> => {
  if (auditLevel === 'none') return;
  const scrubbed = scrubAuditPayload(auditLevel, data);
  await auditLog.record(type, capabilityName, context, scrubbed);
};

const recordHarnessForExecute = async (
  harness: HarnessTracer,
  registry: Registry,
  capabilityName: string,
  context: ExecutionContext,
  toolInput: unknown,
  mode: HarnessMode,
): Promise<void> => {
  const base = {
    traceId: context.traceId,
    userId: context.userId,
    sessionId: context.sessionId,
    intent: context.intent,
  };
  if (mode === 'full') {
    if (context.intent) {
      await harness.recordIntent(base);
    }
    await harness.recordPlan({
      ...base,
      plan: buildHarnessPlan(registry),
    });
  }
  await harness.recordToolSelected({
    ...base,
    capabilityName,
    toolInput,
  });
};

const lookupCapability = (
  registry: Registry,
  capabilityName: string,
): PipelineLookup => {
  const capability = registry.get(capabilityName);
  if (!capability) throw new CapabilityNotFoundError(capabilityName);
  const basePolicy = resolveEffectivePolicy(capability.policy);
  return { capability, capabilityName, basePolicy };
};

const assertIdempotencyKeyPresent = (
  lookup: PipelineLookup,
  options: ExecutionOptions,
): void => {
  if (lookup.basePolicy.requiresIdempotencyKey && !options.idempotencyKey) {
    throw new IdempotencyRequiredError(lookup.capabilityName);
  }
};

const tryReturnIdempotencyCache = async <T>(
  lookup: PipelineLookup,
  options: ExecutionOptions,
  input: unknown,
  idempotencyStore: IdempotencyStore | undefined,
): Promise<ExecutionResult<T> | undefined> => {
  if (!options.idempotencyKey || !idempotencyStore) return undefined;
  const inputHash = hashCapabilityInput(input);
  const storeKey = buildIdempotencyStoreKey(options.idempotencyKey);
  const cached = await idempotencyStore.get(storeKey);
  if (!cached) return undefined;
  if (
    cached.capabilityName !== lookup.capabilityName ||
    cached.inputHash !== inputHash
  ) {
    throw new IdempotencyConflictError(options.idempotencyKey);
  }
  return cached.result as ExecutionResult<T>;
};

const buildExecutionContext = (
  lookup: PipelineLookup,
  options: ExecutionOptions,
  input: unknown,
  runtime: CapabilityRuntime,
): PipelineContext => ({
  ...lookup,
  options,
  inputHash: hashCapabilityInput(input),
  context: {
    userId: options.userId,
    sessionId: options.sessionId ?? randomUUID(),
    traceId: options.traceId ?? randomUUID(),
    intent: options.intent,
    permissions: new Set(options.permissions ?? []),
    runtime,
  },
});

const auditCapabilityInvoked = async (
  config: CapabilityPipelineConfig,
  state: PipelineContext,
  input: unknown,
): Promise<void> => {
  await recordAudit(
    config.auditLog,
    state.capability,
    'capability_invoked',
    state.capabilityName,
    state.context,
    state.basePolicy.auditLevel,
    { input },
  );
};

const validateCapabilityInput = async (
  config: CapabilityPipelineConfig,
  state: PipelineContext,
  input: unknown,
): Promise<PipelineValidated> => {
  const parseResult = state.capability.inputSchema.safeParse(input);
  if (!parseResult.success) {
    await recordAudit(
      config.auditLog,
      state.capability,
      'execution_failed',
      state.capabilityName,
      state.context,
      state.basePolicy.auditLevel,
      { input, error: 'Input validation failed' },
    );
    throw new ValidationError(parseResult.error.issues, state.capabilityName);
  }
  const effectivePolicy = resolveEffectivePolicy(
    state.capability.policy,
    parseResult.data,
  );
  return {
    ...state,
    parsedInput: parseResult.data,
    effectivePolicy,
  };
};

const evaluateCapabilityPolicy = async (
  config: CapabilityPipelineConfig,
  state: PipelineValidated,
): Promise<void> => {
  try {
    evaluatePolicy(state.capabilityName, state.capability.policy, state.context);
  } catch (err) {
    if (err instanceof PolicyViolationError) {
      await recordAudit(
        config.auditLog,
        state.capability,
        'policy_denied',
        state.capabilityName,
        state.context,
        state.effectivePolicy.auditLevel,
        { input: state.parsedInput, error: err.message },
      );
    }
    throw err;
  }
};

const recordHarnessIfConfigured = async (
  config: CapabilityPipelineConfig,
  state: PipelineValidated,
): Promise<void> => {
  if (!config.harness) return;
  await recordHarnessForExecute(
    config.harness,
    config.registry,
    state.capabilityName,
    state.context,
    state.parsedInput,
    config.harnessMode ?? 'full',
  );
};

const runApprovalGateIfRequired = async (
  config: CapabilityPipelineConfig,
  state: PipelineValidated,
): Promise<void> => {
  if (!state.effectivePolicy.requiresApproval) return;
  if (!config.approvalGate) {
    throw new Error(
      `Capability '${state.capabilityName}' requires approval but no ApprovalGate is configured`,
    );
  }
  const riskLevel = describeRisk(state.capability.policy.sideEffects);
  await recordAudit(
    config.auditLog,
    state.capability,
    'approval_requested',
    state.capabilityName,
    state.context,
    state.effectivePolicy.auditLevel,
    { input: state.parsedInput, metadata: { riskLevel } },
  );

  const requestId = randomUUID();
  const result = await config.approvalGate({
    id: requestId,
    capabilityName: state.capabilityName,
    input: state.parsedInput,
    context: state.context,
    riskLevel,
    requestedAt: new Date(),
  });

  if (!result.approved) {
    await recordAudit(
      config.auditLog,
      state.capability,
      'approval_denied',
      state.capabilityName,
      state.context,
      state.effectivePolicy.auditLevel,
      { input: state.parsedInput, metadata: { reason: result.reason } },
    );
    throw new ApprovalDeniedError(requestId, state.capabilityName, result.reason);
  }

  await recordAudit(
    config.auditLog,
    state.capability,
    'approval_granted',
    state.capabilityName,
    state.context,
    state.effectivePolicy.auditLevel,
    { input: state.parsedInput, metadata: { approvedBy: result.approvedBy } },
  );
};

const saveIdempotencyResult = async (
  state: PipelineValidated,
  result: ExecutionResult<unknown>,
  idempotencyStore: IdempotencyStore | undefined,
): Promise<void> => {
  if (!state.options.idempotencyKey || !idempotencyStore) return;
  const storeKey = buildIdempotencyStoreKey(state.options.idempotencyKey);
  await idempotencyStore.set(storeKey, {
    capabilityName: state.capabilityName,
    inputHash: state.inputHash,
    result,
    createdAt: Date.now(),
  });
};

const executeHandlerWithAudit = async <T>(
  config: CapabilityPipelineConfig,
  state: PipelineValidated,
): Promise<ExecutionResult<T>> => {
  try {
    const rawOutput = await state.capability.handler(state.parsedInput, state.context);
    const outputParse = state.capability.outputSchema.safeParse(rawOutput);
    if (!outputParse.success) {
      await recordAudit(
        config.auditLog,
        state.capability,
        'execution_failed',
        state.capabilityName,
        state.context,
        state.effectivePolicy.auditLevel,
        { input: state.parsedInput, error: 'Output validation failed' },
      );
      throw new ValidationError(outputParse.error.issues, state.capabilityName, 'output');
    }
    const validatedOutput = outputParse.data;
    await recordAudit(
      config.auditLog,
      state.capability,
      'execution_succeeded',
      state.capabilityName,
      state.context,
      state.effectivePolicy.auditLevel,
      { input: state.parsedInput, output: validatedOutput },
    );
    const result: ExecutionResult<T> = {
      success: true,
      output: validatedOutput as T,
      traceId: state.context.traceId,
    };
    await saveIdempotencyResult(state, result, config.idempotencyStore);
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await recordAudit(
      config.auditLog,
      state.capability,
      'execution_failed',
      state.capabilityName,
      state.context,
      state.effectivePolicy.auditLevel,
      { input: state.parsedInput, error: errorMessage },
    );
    throw err;
  }
};

/**
 * ケイパビリティ実行パイプライン。lookup → 冪等 → 検証 → ポリシー → 承認 → 実行。
 */
export const runCapabilityPipeline = async <T>(
  capabilityName: string,
  input: unknown,
  options: ExecutionOptions,
  config: CapabilityPipelineConfig,
): Promise<ExecutionResult<T>> => {
  const lookup = lookupCapability(config.registry, capabilityName);
  assertIdempotencyKeyPresent(lookup, options);

  const cached = await tryReturnIdempotencyCache<T>(
    lookup,
    options,
    input,
    config.idempotencyStore,
  );
  if (cached) return cached;

  const runtime = config.runtime ?? {};
  const contextState = buildExecutionContext(lookup, options, input, runtime);
  await auditCapabilityInvoked(config, contextState, input);

  const validated = await validateCapabilityInput(config, contextState, input);
  await evaluateCapabilityPolicy(config, validated);
  await recordHarnessIfConfigured(config, validated);
  await runApprovalGateIfRequired(config, validated);

  return executeHandlerWithAudit<T>(config, validated);
};
