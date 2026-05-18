import type { CapabilityMeta } from '../core/cap-meta.js';

/** HTML フォーム用に正規化した入力フィールド。 */
export type CapFormField = {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description?: string;
  readonly enumValues?: readonly string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const schemaType = (prop: Record<string, unknown>): string => {
  if (Array.isArray(prop.type)) {
    const filtered = prop.type.filter((t) => t !== 'null');
    return String(filtered[0] ?? 'string');
  }
  if (typeof prop.type === 'string') return prop.type;
  if (prop.enum !== undefined) return 'string';
  return 'string';
};

/**
 * cap-meta の OpenAPI 風 `inputSchema` からフォームフィールド一覧を抽出する。
 */
export const fieldsFromInputSchema = (
  inputSchema: Record<string, unknown>,
): CapFormField[] => {
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const requiredSet = new Set(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter((name): name is string => typeof name === 'string')
      : [],
  );

  return Object.entries(properties).map(([name, raw]) => {
    const prop = isRecord(raw) ? raw : {};
    const type = schemaType(prop);
    const enumValues = Array.isArray(prop.enum)
      ? prop.enum.filter((v): v is string => typeof v === 'string')
      : undefined;
    const description = typeof prop.description === 'string' ? prop.description : undefined;
    return {
      name,
      type,
      required: requiredSet.has(name),
      description,
      ...(enumValues && enumValues.length > 0 ? { enumValues } : {}),
    };
  });
};

/**
 * レジストリメタからケイパビリティ入力フォーム用フィールドを返す。
 */
export const fieldsFromCapabilityMeta = (meta: CapabilityMeta): CapFormField[] =>
  fieldsFromInputSchema(meta.inputSchema);

/** HTML フォームボディのパース失敗。 */
export class FormBodyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormBodyParseError';
  }
}

/**
 * `application/x-www-form-urlencoded` をケイパビリティ入力オブジェクトに変換する。
 */
export const formUrlEncodedToCapabilityInput = (
  fields: readonly CapFormField[],
  params: URLSearchParams,
): Record<string, unknown> => {
  const input: Record<string, unknown> = {};
  fields.forEach((field) => {
    const raw = params.get(field.name);
    if (raw === null) {
      if (field.type === 'boolean') {
        input[field.name] = false;
      }
      return;
    }
    if (field.type === 'boolean') {
      input[field.name] = raw === 'true' || raw === 'on';
      return;
    }
    if (field.type === 'integer') {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed)) {
        throw new FormBodyParseError(`Invalid integer for field "${field.name}"`);
      }
      input[field.name] = parsed;
      return;
    }
    if (field.type === 'number') {
      const parsed = Number.parseFloat(raw);
      if (Number.isNaN(parsed)) {
        throw new FormBodyParseError(`Invalid number for field "${field.name}"`);
      }
      input[field.name] = parsed;
      return;
    }
    if (field.type === 'array' || field.type === 'object') {
      try {
        input[field.name] = JSON.parse(raw) as unknown;
      } catch {
        throw new FormBodyParseError(`Invalid JSON for field "${field.name}"`);
      }
      return;
    }
    input[field.name] = raw;
  });
  return input;
};
