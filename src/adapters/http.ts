import type { IncomingMessage, ServerResponse } from 'node:http';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Registry } from '../core/registry.js';
import type { Engine, ExecutionOptions } from '../core/execution.js';
import { CapabilityNotFoundError, ValidationError } from '../core/execution.js';
import { PolicyViolationError } from '../core/policy.js';
import { ApprovalDeniedError } from '../core/approval.js';

/** `GET /capabilities` および `GET /capabilities/:name` が返すケイパビリティのシリアライズ済みメタデータ。 */
export interface CapabilityMeta {
  /** ケイパビリティ名。 */
  name: string;
  /** ケイパビリティの説明文。 */
  description: string;
  /** OpenAPI 3 形式の入力 JSON スキーマ。 */
  inputSchema: Record<string, unknown>;
  /** ポリシーのシリアライズ済み表現。 */
  policy: {
    requiredPermissions: string[];
    sideEffects: string[];
    requiresApproval: boolean;
    auditLevel: string;
  };
}

/** `createHttpAdapter` のオプション。 */
export interface HttpAdapterOptions {
  /** 全ルートの URL プレフィックス（デフォルト: `''`）。サブパスへのマウント時に指定する。 */
  basePath?: string;
  /** リクエストから `ExecutionOptions` を解決する関数。認証・認可の境界としてここで実装する（必須）。 */
  resolveExecutionOptions: (req: IncomingMessage) => ExecutionOptions | Promise<ExecutionOptions>;
  /** リクエストボディの最大サイズ（バイト）。デフォルト: 1 MiB。 */
  maxBodyBytes?: number;
  /** CORS オリジンの許可リスト。リストに含まれるオリジンにのみ `Access-Control-Allow-Origin` / `Allow-Methods` / `Allow-Headers` を返す。 */
  corsOrigins?: string[];
}

/**
 * `createHttpAdapter` が返すハンドラーオブジェクト。
 * `handler` は Node.js `http` モジュールと直接互換。`express` は Express ミドルウェアとして使用できる。
 */
export type HttpAdapter = {
  /**
   * リクエストを処理した場合は `true`、ルートに一致しなかった場合は `false` を返す。
   * `false` のとき呼び出し元は次のハンドラーに委譲できる。
   */
  readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  /** Express / Connect 互換のミドルウェア。マッチしない場合は `next()` を呼ぶ。 */
  readonly express: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function buildCapMeta(cap: ReturnType<Registry['getAll']>[number]): CapabilityMeta {
  const jsonSchema = zodToJsonSchema(cap.inputSchema, { target: 'openApi3' });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, ...inputSchema } = jsonSchema as Record<string, unknown>;
  return {
    name: cap.name,
    description: cap.description,
    inputSchema: inputSchema as Record<string, unknown>,
    policy: {
      requiredPermissions: cap.policy.requiredPermissions,
      sideEffects: cap.policy.sideEffects,
      requiresApproval: cap.policy.requiresApproval ?? false,
      auditLevel: cap.policy.auditLevel,
    },
  };
}

function buildMeta(registry: Registry): CapabilityMeta[] {
  return registry.getAll().map(buildCapMeta);
}

function errorToResponse(err: unknown): { status: number; body: unknown } {
  if (err instanceof CapabilityNotFoundError) {
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: err.message } } };
  }
  if (err instanceof ValidationError) {
    return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: err.message, issues: err.issues } } };
  }
  if (err instanceof PolicyViolationError) {
    return { status: 403, body: { error: { code: 'FORBIDDEN', message: err.message } } };
  }
  if (err instanceof ApprovalDeniedError) {
    return { status: 409, body: { error: { code: 'APPROVAL_DENIED', message: err.message } } };
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message } } };
}

/**
 * 登録済みケイパビリティを REST エンドポイントとして公開する Node.js HTTP アダプターを生成する。
 *
 * ルート:
 * - `GET  {basePath}/capabilities` — 全ケイパビリティのメタデータ一覧
 * - `GET  {basePath}/capabilities/:name` — 指定ケイパビリティのメタデータ
 * - `POST {basePath}/capabilities/:name` — ケイパビリティの実行（JSON ボディを入力として受け取る）
 *
 * @param registry - ケイパビリティ定義のソース。
 * @param engine - POST リクエストの実行に使用するエンジン。
 * @param options - ベースパス・認証リゾルバー・CORS などの設定。
 */
export function createHttpAdapter(
  registry: Registry,
  engine: Engine,
  options: HttpAdapterOptions,
): HttpAdapter {
  const basePath = options.basePath ?? '';
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const corsOrigins = options.corsOrigins ?? [];

  const setCors = (req: IncomingMessage, res: ServerResponse): void => {
    const origin = req.headers['origin'];
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    setCors(req, res);
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }

    const listPath = `${basePath}/capabilities`;
    const capPath = `${basePath}/capabilities/`;

    if (method === 'GET' && url === listPath) {
      sendJson(res, 200, { capabilities: buildMeta(registry) });
      return true;
    }

    if (method === 'GET' && url.startsWith(capPath)) {
      const name = decodeURIComponent(url.slice(capPath.length).split('?')[0]);
      const cap = registry.get(name);
      if (!cap) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `Capability '${name}' not found` } });
        return true;
      }
      sendJson(res, 200, buildCapMeta(cap));
      return true;
    }

    if (method === 'POST' && url.startsWith(capPath)) {
      const name = decodeURIComponent(url.slice(capPath.length).split('?')[0]);
      try {
        const rawBody = await readBody(req, maxBodyBytes);
        const input = rawBody ? JSON.parse(rawBody) : {};
        const execOptions = await options.resolveExecutionOptions(req);
        const result = await engine.execute(name, input, execOptions);
        sendJson(res, 200, result);
      } catch (err) {
        const { status, body } = errorToResponse(err);
        sendJson(res, status, body);
      }
      return true;
    }

    return false;
  };

  return {
    handler,
    express(req, res, next) {
      handler(req, res).then((handled) => {
        if (!handled) next();
      }).catch(() => next());
    },
  };
}
