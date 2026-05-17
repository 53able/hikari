import type { Registry } from './registry.js';
import { buildRegistryMeta } from './cap-meta.js';

/** OpenAPI 3.0 ドキュメント（ケイパビリティ REST 向けの最小スキーマ）。 */
export type OpenApiDocument = {
  readonly openapi: '3.0.3';
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, unknown>;
  readonly components?: { readonly schemas?: Record<string, unknown> };
};

/** `exportOpenApiDocument` のオプション。 */
export type OpenApiExportOptions = {
  readonly title?: string;
  readonly version?: string;
  /** パスプレフィックス（例: `/api`）。デフォルト: `/api`。 */
  readonly basePath?: string;
};

const refName = (capabilityName: string, suffix: 'Input' | 'Output'): string =>
  `${capabilityName}${suffix}`;

/**
 * レジストリの cap-meta から OpenAPI 3.0 JSON ドキュメントを生成する。
 * `POST {basePath}/capabilities/{name}` 実行エンドポイントを列挙する。
 */
export const exportOpenApiDocument = (
  registry: Registry,
  options: OpenApiExportOptions = {},
): OpenApiDocument => {
  const basePath = options.basePath ?? '/api';
  const title = options.title ?? 'Hikari Capabilities API';
  const version = options.version ?? '0.1.0';
  const metas = buildRegistryMeta(registry);

  const schemas: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {
    [`${basePath}/capabilities`]: {
      get: {
        summary: 'List registered capabilities',
        responses: {
          '200': {
            description: 'Capability metadata list',
          },
        },
      },
    },
  };

  for (const meta of metas) {
    const inputRef = refName(meta.name, 'Input');
    const outputRef = refName(meta.name, 'Output');
    schemas[inputRef] = meta.inputSchema;
    schemas[outputRef] = meta.outputSchema;

    paths[`${basePath}/capabilities/${meta.name}`] = {
      post: {
        summary: meta.description,
        operationId: `execute_${meta.name}`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${inputRef}` },
            },
          },
        },
        responses: {
          '200': {
            description: 'Execution succeeded',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${outputRef}` },
              },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: { title, version },
    paths,
    components: { schemas },
  };
};
