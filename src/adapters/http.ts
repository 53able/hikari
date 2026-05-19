import type { Registry } from '../core/registry.js';
import type { Engine, ExecutionOptions } from '../core/execution.js';
import {
  CapabilityNotFoundError,
  ValidationError,
  IdempotencyConflictError,
} from '../core/execution.js';
import { PolicyViolationError } from '../core/policy.js';
import { ApprovalDeniedError } from '../core/approval.js';
import { buildCapabilityMeta, buildRegistryMeta, type CapabilityMeta } from '../core/cap-meta.js';
import {
  fieldsFromCapabilityMeta,
  formUrlEncodedToCapabilityInput,
  FormBodyParseError,
} from '../web/cap-form-schema.js';
import { exportOpenApiDocument } from '../core/openapi-export.js';
import type { RateLimitGuard } from '../core/rate-limit.js';
import { clientIpFromRequest } from '../core/rate-limit.js';
import { wantsHtmlResponse } from '../web/http-request.js';
import { renderCapabilityResultHtml } from '../web/cap-result-page.js';

export type { CapabilityMeta };

/** `createHttpAdapter` のオプション。 */
export interface HttpAdapterOptions {
  /** 全ルートの URL プレフィックス（デフォルト: `''`）。サブパスへのマウント時に指定する。 */
  basePath?: string;
  /** リクエストから `ExecutionOptions` を解決する関数。認証・認可の境界としてここで実装する（必須）。 */
  resolveExecutionOptions: (req: Request) => ExecutionOptions | Promise<ExecutionOptions>;
  /** リクエストボディの最大サイズ（バイト）。デフォルト: 1 MiB。 */
  maxBodyBytes?: number;
  /** CORS オリジンの許可リスト。リストに含まれるオリジンにのみ CORS ヘッダーを返す。 */
  corsOrigins?: string[];
  /** 指定時は POST 実行前に IP / userId / capability 単位でレート制限する。 */
  rateLimitGuard?: RateLimitGuard;
  /**
   * `Accept: text/html` の POST 実行時に結果 HTML を返す。
   * `uiBasePath` はフォーム・一覧へのリンク用（デフォルト: `/capabilities`）。
   */
  capabilityResultHtml?: {
    readonly uiBasePath?: string;
  };
}

/**
 * `createHttpAdapter` が返す fetch ハンドラー。
 * ルートに一致しない場合は `null` を返し、呼び出し元が次のハンドラーへ委譲できる。
 */
export type HttpAdapter = {
  readonly fetch: (req: Request) => Promise<Response | null>;
};

const idempotencyKeyFromRequest = (req: Request): string | undefined => {
  const raw = req.headers.get('idempotency-key');
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const mergeIdempotencyKey = (
  req: Request,
  execOptions: ExecutionOptions,
): ExecutionOptions => {
  const idempotencyKey = idempotencyKeyFromRequest(req);
  return idempotencyKey ? { ...execOptions, idempotencyKey } : execOptions;
};

const jsonResponse = (status: number, body: unknown, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const htmlResponse = (status: number, html: string, headers?: HeadersInit): Response =>
  new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
  });

const corsHeaders = (req: Request, corsOrigins: readonly string[]): HeadersInit => {
  const origin = req.headers.get('origin');
  if (!origin || !corsOrigins.includes(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Idempotency-Key',
  };
};

const capabilityResponse = (
  req: Request,
  status: number,
  body: unknown,
  capabilityName: string,
  uiBasePath: string,
  cors: HeadersInit,
): Response => {
  if (!wantsHtmlResponse(req)) {
    return jsonResponse(status, body, cors);
  }
  const formUrl = `${uiBasePath}/${encodeURIComponent(capabilityName)}/form`;
  const html = renderCapabilityResultHtml({
    capabilityName,
    status,
    body,
    formUrl,
    listUrl: uiBasePath,
  });
  return htmlResponse(status, html, cors);
};

const readBodyText = async (req: Request, maxBytes: number): Promise<string> => {
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw Object.assign(new Error('Request body too large'), { status: 413 });
  }
  return new TextDecoder().decode(buffer);
};

const errorToResponse = (err: unknown): { status: number; body: unknown } => {
  if (err instanceof CapabilityNotFoundError) {
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: err.message } } };
  }
  if (err instanceof ValidationError) {
    return {
      status: 400,
      body: {
        error: { code: 'VALIDATION_ERROR', message: err.message, issues: err.issues },
      },
    };
  }
  if (err instanceof FormBodyParseError) {
    return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: err.message } } };
  }
  if (err instanceof PolicyViolationError) {
    return { status: 403, body: { error: { code: 'FORBIDDEN', message: err.message } } };
  }
  if (err instanceof ApprovalDeniedError) {
    return { status: 409, body: { error: { code: 'APPROVAL_DENIED', message: err.message } } };
  }
  if (err instanceof IdempotencyConflictError) {
    return {
      status: 409,
      body: { error: { code: 'IDEMPOTENCY_CONFLICT', message: err.message } },
    };
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message } } };
};

const pathnameFromRequest = (req: Request): string => new URL(req.url).pathname;

/**
 * 登録済みケイパビリティを REST エンドポイントとして公開する fetch アダプターを生成する。
 *
 * ルート:
 * - `GET  {basePath}/capabilities` — 全ケイパビリティのメタデータ一覧
 * - `GET  {basePath}/capabilities/:name` — 指定ケイパビリティのメタデータ
 * - `POST {basePath}/capabilities/:name` — ケイパビリティの実行（JSON ボディを入力として受け取る）
 */
export function createHttpAdapter(
  registry: Registry,
  engine: Engine,
  options: HttpAdapterOptions,
): HttpAdapter {
  const basePath = options.basePath ?? '';
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const corsOrigins = options.corsOrigins ?? [];
  const uiBasePath = options.capabilityResultHtml?.uiBasePath ?? '/capabilities';

  const fetchHandler = async (req: Request): Promise<Response | null> => {
    const cors = corsHeaders(req, corsOrigins);
    const method = req.method;
    const pathname = pathnameFromRequest(req);

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const listPath = `${basePath}/capabilities`;
    const capPath = `${basePath}/capabilities/`;
    const openApiPath = `${basePath}/openapi.json`;

    if (method === 'GET' && pathname === openApiPath) {
      return jsonResponse(200, exportOpenApiDocument(registry, { basePath }), cors);
    }

    if (method === 'GET' && pathname === listPath) {
      return jsonResponse(200, { capabilities: buildRegistryMeta(registry) }, cors);
    }

    if (method === 'GET' && pathname.startsWith(capPath)) {
      const name = decodeURIComponent(pathname.slice(capPath.length).split('/')[0] ?? '');
      const cap = registry.get(name);
      if (!cap) {
        return jsonResponse(
          404,
          { error: { code: 'NOT_FOUND', message: `Capability '${name}' not found` } },
          cors,
        );
      }
      return jsonResponse(200, buildCapabilityMeta(cap), cors);
    }

    if (method === 'POST' && pathname.startsWith(capPath)) {
      const name = decodeURIComponent(pathname.slice(capPath.length).split('/')[0] ?? '');
      const cap = registry.get(name);
      if (!cap) {
        const notFoundBody = {
          error: { code: 'NOT_FOUND', message: `Capability '${name}' not found` },
        };
        return capabilityResponse(req, 404, notFoundBody, name, uiBasePath, cors);
      }
      try {
        const rawBody = await readBodyText(req, maxBodyBytes);
        const contentType = (req.headers.get('content-type') ?? '')
          .split(';')[0]
          ?.trim()
          .toLowerCase();
        const input =
          !rawBody
            ? {}
            : contentType === 'application/x-www-form-urlencoded'
              ? formUrlEncodedToCapabilityInput(
                  fieldsFromCapabilityMeta(buildCapabilityMeta(cap)),
                  new URLSearchParams(rawBody),
                )
              : (JSON.parse(rawBody) as Record<string, unknown>);
        const execOptions = mergeIdempotencyKey(
          req,
          await options.resolveExecutionOptions(req),
        );
        if (options.rateLimitGuard) {
          const limited = await Promise.resolve(
            options.rateLimitGuard.check({
              ip: clientIpFromRequest(req),
              userId: execOptions.userId,
              capabilityName: name,
            }),
          );
          if (!limited.allowed) {
            return jsonResponse(
              429,
              {
                error: {
                  code: 'RATE_LIMITED',
                  message: 'Too many requests',
                  retryAfterSeconds: limited.retryAfterSeconds,
                },
              },
              { ...cors, 'Retry-After': String(limited.retryAfterSeconds) },
            );
          }
        }
        const result = await engine.execute(name, input, execOptions);
        return capabilityResponse(req, 200, result, name, uiBasePath, cors);
      } catch (err) {
        if (err && typeof err === 'object' && 'status' in err && err.status === 413) {
          return capabilityResponse(
            req,
            413,
            { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } },
            name,
            uiBasePath,
            cors,
          );
        }
        const { status, body } = errorToResponse(err);
        return capabilityResponse(req, status, body, name, uiBasePath, cors);
      }
    }

    return null;
  };

  return { fetch: fetchHandler };
}
