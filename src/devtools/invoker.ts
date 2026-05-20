import { z } from 'zod';
import type { Registry } from '../core/registry.js';
import type { ApprovalGate } from '../core/approval.js';
import type { AuditLogger, InMemoryStorage } from '../core/audit.js';
import { createAuditLog, createInMemoryStorage } from '../core/audit.js';
import { devAutoApprove } from '../core/approval.js';
import { createEngine, type Engine, type ExecutionResult } from '../core/execution.js';
import { enrichExecutionOptionsWithIdempotency } from '../core/idempotency-key.js';

/** CLI / 環境変数から解釈した invoke リクエスト。 */
export const invokeRequestSchema = z.object({
  capabilityName: z.string().min(1),
  input: z.unknown(),
  userId: z.string().min(1),
  permissions: z.array(z.string()),
  intent: z.string().optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
});

export type InvokeRequest = z.infer<typeof invokeRequestSchema>;

/** `CapabilityInvoker.invoke` の戻り値（成功・失敗を同一形状で返す）。 */
export const invokeReportSchema = z.object({
  ok: z.boolean(),
  capability: z.string(),
  result: z
    .object({
      success: z.literal(true),
      output: z.unknown(),
      traceId: z.string(),
    })
    .optional(),
  error: z
    .object({
      name: z.string(),
      message: z.string(),
    })
    .optional(),
  auditEntryCount: z.number().int().nonnegative(),
});

export type InvokeReport = z.infer<typeof invokeReportSchema>;

const invokeCliDefaultsSchema = z.object({
  capabilityName: z.string().min(1).optional(),
  inputJson: z.string().optional(),
  userId: z.string().min(1).optional(),
});

/** `parseInvokeCliArgs` の既定値。 */
export type InvokeCliDefaults = z.infer<typeof invokeCliDefaultsSchema>;

export type ParsedInvokeCli =
  | { readonly mode: 'list' }
  | {
      readonly mode: 'invoke';
      readonly capabilityName: string;
      readonly input: unknown;
      readonly permissions: readonly string[];
    };

/** `createCapabilityInvoker` の構成オプション。 */
export type CapabilityInvokerOptions = {
  readonly registry: Registry;
  readonly userId?: string;
  readonly defaultCapabilityName?: string;
  readonly approvalGate?: ApprovalGate;
  readonly auditLog?: AuditLogger;
  readonly storage?: InMemoryStorage;
  readonly engine?: Engine;
};

/** 開発用の決定論的 capability 実行（API キー不要）。 */
export type CapabilityInvoker = {
  readonly registry: Registry;
  readonly engine: Engine;
  readonly storage: InMemoryStorage;
  readonly listCapabilityNames: () => readonly string[];
  readonly formatCapabilityList: () => string;
  readonly invoke: (request: InvokeRequest) => Promise<InvokeReport>;
};

const parseInputJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON input: ${raw}`);
  }
};

const parsePermissions = (raw: string): readonly string[] =>
  raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

/**
 * `process.argv` 断片と環境変数から invoke CLI 引数を解釈する。
 *
 * 環境変数: `HIKARI_CAP`, `HIKARI_INPUT`, `HIKARI_PERMISSIONS`
 */
export const parseInvokeCliArgs = (
  argv: readonly string[],
  defaults?: InvokeCliDefaults,
): ParsedInvokeCli => {
  const parsedDefaults = invokeCliDefaultsSchema.parse(defaults ?? {});

  if (argv.includes('--list') || argv.includes('-l')) {
    return { mode: 'list' };
  }

  const positional = argv.filter((arg) => !arg.startsWith('-'));
  const capabilityName =
    process.env.HIKARI_CAP ?? positional[0] ?? parsedDefaults.capabilityName;

  if (!capabilityName) {
    throw new Error(
      'Missing capability name. Pass <name>, set HIKARI_CAP, or use --list.',
    );
  }
  const inputRaw =
    process.env.HIKARI_INPUT ??
    positional[1] ??
    parsedDefaults.inputJson ??
    '{}';
  const permissionsRaw = process.env.HIKARI_PERMISSIONS ?? positional[2] ?? '';

  return {
    mode: 'invoke',
    capabilityName,
    input: parseInputJson(inputRaw),
    permissions: parsePermissions(permissionsRaw),
  };
};

/** `InvokeReport` を整形 JSON 文字列にする。 */
export const formatInvokeReport = (report: InvokeReport): string =>
  JSON.stringify(invokeReportSchema.parse(report), null, 2);

/**
 * 任意のレジストリに対する開発用 invoker を生成する。
 * 既定ではインメモリ監査と `devAutoApprove` を使用する。
 */
export const createCapabilityInvoker = (
  options: CapabilityInvokerOptions,
): CapabilityInvoker => {
  const storage = options.storage ?? createInMemoryStorage();
  const auditLog = options.auditLog ?? createAuditLog(storage);
  const approvalGate = options.approvalGate ?? devAutoApprove;
  const engine =
    options.engine ??
    createEngine({
      registry: options.registry,
      auditLog,
      approvalGate,
    });
  const defaultUserId = options.userId ?? 'dev';

  const listCapabilityNames = (): readonly string[] => options.registry.list();

  const formatCapabilityList = (): string => {
    const lines = listCapabilityNames().map((name) => {
      const cap = options.registry.get(name);
      const desc = cap?.description.slice(0, 72) ?? '';
      return `  ${name.padEnd(16)} ${desc}`;
    });
    return `Registered capabilities (${lines.length}):\n${lines.join('\n')}\n`;
  };

  const invoke = async (request: InvokeRequest): Promise<InvokeReport> => {
    const parsed = invokeRequestSchema.parse(request);
    const capability = options.registry.get(parsed.capabilityName);

    if (!capability) {
      return invokeReportSchema.parse({
        ok: false,
        capability: parsed.capabilityName,
        error: {
          name: 'CapabilityNotFoundError',
          message: `Capability '${parsed.capabilityName}' not found in registry`,
        },
        auditEntryCount: storage.getAll().length,
      });
    }

    const intent =
      parsed.intent ?? `capability-invoker ${parsed.capabilityName}`;

    try {
      const execOptions = enrichExecutionOptionsWithIdempotency(
        options.registry,
        parsed.capabilityName,
        {
          userId: parsed.userId,
          permissions: [...parsed.permissions],
          intent,
          idempotencyKey: parsed.idempotencyKey,
        },
        { input: parsed.input },
      );
      const result: ExecutionResult = await engine.execute(
        parsed.capabilityName,
        parsed.input,
        execOptions,
      );

      return invokeReportSchema.parse({
        ok: true,
        capability: parsed.capabilityName,
        result,
        auditEntryCount: storage.getAll().length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : 'Error';
      return invokeReportSchema.parse({
        ok: false,
        capability: parsed.capabilityName,
        error: { name, message },
        auditEntryCount: storage.getAll().length,
      });
    }
  };

  return {
    registry: options.registry,
    engine,
    storage,
    listCapabilityNames,
    formatCapabilityList,
    invoke,
  };
};

/**
 * CLI 向けに list / invoke を実行し、終了コードを返す（`process.exit` は呼ばない）。
 */
export const runInvokeCli = async (
  invoker: CapabilityInvoker,
  argv: readonly string[],
  defaults?: InvokeCliDefaults,
): Promise<number> => {
  const parsed = parseInvokeCliArgs(argv, defaults);

  if (parsed.mode === 'list') {
    process.stdout.write(invoker.formatCapabilityList());
    return 0;
  }

  const report = await invoker.invoke({
    capabilityName: parsed.capabilityName,
    input: parsed.input,
    userId: defaults?.userId ?? 'dev',
    permissions: [...parsed.permissions],
  });

  process.stdout.write(`${formatInvokeReport(report)}\n`);

  if (!report.ok && !invoker.registry.get(parsed.capabilityName)) {
    process.stdout.write(invoker.formatCapabilityList());
  }

  return report.ok ? 0 : 1;
};
