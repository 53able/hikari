import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Capability } from './capability.js';
import { needsHumanApproval } from './policy.js';
import type { Registry } from './registry.js';

/** レジストリから派生するケイパビリティのシリアライズ済みメタデータ（HTTP・devtools・ドキュメント生成で共有）。 */
export type CapabilityMeta = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  policy: {
    requiredPermissions: string[];
    sideEffects: string[];
    primaryEffect: string;
    requiresApproval: boolean;
    requiresApprovalWhen: boolean;
    auditLevel: string;
  };
};

const zodToOpenApi = (schema: Capability['inputSchema']): Record<string, unknown> => {
  const jsonSchema = zodToJsonSchema(schema, { target: 'openApi3' });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
};

/**
 * 単一ケイパビリティのメタデータを構築する。レジストリを source of truth とした派生ビュー。
 */
export const buildCapabilityMeta = (cap: Capability): CapabilityMeta => ({
  name: cap.name,
  description: cap.description,
  inputSchema: zodToOpenApi(cap.inputSchema),
  outputSchema: zodToOpenApi(cap.outputSchema),
  policy: {
    requiredPermissions: cap.policy.requiredPermissions,
    sideEffects: cap.policy.sideEffects,
    primaryEffect: cap.policy.sideEffects[0] ?? 'read',
    requiresApproval: cap.policy.requiresApproval === true,
    requiresApprovalWhen: cap.policy.requiresApprovalWhen !== undefined,
    auditLevel: cap.policy.auditLevel,
  },
});

/** 登録済みケイパビリティのメタデータ一覧を返す。 */
export const buildRegistryMeta = (registry: Registry): CapabilityMeta[] =>
  registry.getAll().map(buildCapabilityMeta);

/** 静的承認要否（入力非依存）の一覧。 */
export const listApprovalRequired = (registry: Registry): string[] =>
  registry
    .getAll()
    .filter((cap) => needsHumanApproval(cap.policy))
    .map((cap) => cap.name);
