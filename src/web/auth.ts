import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import {
  normalizeExecutionOptions,
  type ExecutionOptions,
  type NormalizedExecutionOptions,
} from '../core/execution.js';
import {
  HIKARI_PERMISSIONS_COOKIE,
  HIKARI_USER_ID_COOKIE,
} from './dev-session.js';

/** JWT ペイロードから解決する `ExecutionOptions` の Zod スキーマ。 */
export const jwtExecutionPayloadSchema = z.object({
  sub: z.string().min(1),
  permissions: z.array(z.string()).optional(),
  sessionId: z.string().optional(),
  traceId: z.string().optional(),
});

export type JwtExecutionPayload = z.infer<typeof jwtExecutionPayloadSchema>;

/**
 * 検証済み JWT ペイロードを `ExecutionOptions` に変換する。
 */
export const executionOptionsFromJwtPayload = (
  payload: JwtExecutionPayload,
): NormalizedExecutionOptions =>
  normalizeExecutionOptions({
    userId: payload.sub,
    permissions: payload.permissions,
    sessionId: payload.sessionId,
    traceId: payload.traceId,
  });

/** `Cookie` ヘッダー文字列をキー・値マップにパースする。 */
export const parseCookieHeader = (
  cookieHeader: string | undefined,
): Readonly<Record<string, string>> => {
  if (!cookieHeader) {
    return {};
  }
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eq = part.indexOf('=');
        if (eq < 0) {
          return [part, ''] as const;
        }
        const key = part.slice(0, eq).trim();
        const value = decodeURIComponent(part.slice(eq + 1).trim());
        return [key, value] as const;
      }),
  );
};

const permissionsFromRaw = (raw: string | undefined): string[] =>
  raw
    ? raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

/** `createHeaderExecutionOptionsResolver` のオプション。 */
export type HeaderAuthResolverOptions = {
  /** ユーザー ID ヘッダー名。デフォルト: `x-hikari-user-id`。 */
  readonly userIdHeader?: string;
  /** カンマ区切り権限ヘッダー名。デフォルト: `x-hikari-permissions`。 */
  readonly permissionsHeader?: string;
  readonly sessionIdHeader?: string;
  readonly traceIdHeader?: string;
  /**
   * ヘッダー未指定時に Cookie から補完する（ブラウザ投影フォーム向け・開発用）。
   * ヘッダーが指定されていれば Cookie より優先する。
   */
  readonly readCookies?: boolean;
  readonly userIdCookie?: string;
  readonly permissionsCookie?: string;
};

/**
 * 開発用: HTTP ヘッダーから `ExecutionOptions` を組み立てる。
 * 本番では JWT 等の署名付きトークン検証に置き換えること。
 */
export const createHeaderExecutionOptionsResolver = (
  options: HeaderAuthResolverOptions = {},
): ((req: IncomingMessage) => NormalizedExecutionOptions) => {
  const userIdHeader = options.userIdHeader ?? 'x-hikari-user-id';
  const permissionsHeader = options.permissionsHeader ?? 'x-hikari-permissions';
  const sessionIdHeader = options.sessionIdHeader ?? 'x-hikari-session-id';
  const traceIdHeader = options.traceIdHeader ?? 'x-hikari-trace-id';
  const userIdCookie = options.userIdCookie ?? HIKARI_USER_ID_COOKIE;
  const permissionsCookie = options.permissionsCookie ?? HIKARI_PERMISSIONS_COOKIE;

  return (req) => {
    const cookies = options.readCookies
      ? parseCookieHeader(req.headers.cookie)
      : {};
    const userId =
      (req.headers[userIdHeader] as string | undefined) ??
      cookies[userIdCookie] ??
      'anonymous';
    const permissionsRaw =
      (req.headers[permissionsHeader] as string | undefined) ??
      cookies[permissionsCookie];
    const permissions = permissionsFromRaw(permissionsRaw);
    const sessionId = req.headers[sessionIdHeader] as string | undefined;
    const traceId = req.headers[traceIdHeader] as string | undefined;
    return normalizeExecutionOptions({ userId, permissions, sessionId, traceId });
  };
};

const base64UrlDecode = (segment: string): Buffer => {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
};

const verifyHmacJwt = (
  token: string,
  secret: string,
): JwtExecutionPayload | undefined => {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = createHmac('sha256', secret)
    .update(signingInput)
    .digest();
  const actual = base64UrlDecode(signatureB64);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return undefined;
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    return undefined;
  }

  const parsed = jwtExecutionPayloadSchema.safeParse(payloadJson);
  return parsed.success ? parsed.data : undefined;
};

/** `createHmacJwtExecutionOptionsResolver` のオプション。 */
export type HmacJwtAuthResolverOptions = {
  /** HMAC 署名用シークレット（環境変数 `HIKARI_JWT_SECRET` でも指定可）。 */
  readonly secret?: string;
  /** Authorization ヘッダーのプレフィックス。デフォルト: `Bearer `。 */
  readonly bearerPrefix?: string;
  /** JWT 検証失敗時にヘッダーリゾルバへフォールバックするか。デフォルト: `false`。 */
  readonly fallbackToHeaders?: boolean;
  readonly headerFallback?: HeaderAuthResolverOptions;
};

/**
 * HS256 風 HMAC JWT（外部ライブラリなし）を検証し `ExecutionOptions` を返す。
 * 発行側は同じ secret で `header.payload` に対する HMAC-SHA256 を base64url 署名する。
 */
export const createHmacJwtExecutionOptionsResolver = (
  options: HmacJwtAuthResolverOptions = {},
): ((req: IncomingMessage) => NormalizedExecutionOptions) => {
  const secret = options.secret ?? process.env.HIKARI_JWT_SECRET;
  const bearerPrefix = options.bearerPrefix ?? 'Bearer ';
  const headerFallback = createHeaderExecutionOptionsResolver(options.headerFallback);

  return (req) => {
    const auth = req.headers.authorization;
    if (secret && auth?.startsWith(bearerPrefix)) {
      const token = auth.slice(bearerPrefix.length).trim();
      const payload = verifyHmacJwt(token, secret);
      if (payload) {
        return executionOptionsFromJwtPayload(payload);
      }
    }

    if (options.fallbackToHeaders) {
      return headerFallback(req);
    }

    return normalizeExecutionOptions({ userId: 'anonymous', permissions: [] });
  };
};
