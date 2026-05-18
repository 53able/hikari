import type { ServerResponse } from 'node:http';

/** 開発用セッション Cookie 名（`createHeaderExecutionOptionsResolver` のデフォルトと一致）。 */
export const HIKARI_USER_ID_COOKIE = 'hikari-user-id';

/** 開発用権限 Cookie 名。 */
export const HIKARI_PERMISSIONS_COOKIE = 'hikari-permissions';

/** `setCookie` / `Set-Cookie` 共通オプション。 */
export const devSessionCookieOptions = {
  path: '/',
  maxAge: 60 * 60 * 24 * 7,
  sameSite: 'Lax' as const,
  httpOnly: false,
} as const;

/** dev-session POST のパース結果。 */
export type DevSessionForm = {
  readonly userId: string;
  readonly permissions: string;
};

/**
 * dev-session フォーム POST ボディをパースする（urlencoded または JSON）。
 * @returns 成功時はフォーム値、失敗時は `{ error }`。
 */
export const parseDevSessionFormBody = (
  raw: string,
  contentType: string | undefined,
): DevSessionForm | { readonly error: string } => {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  const userIdFromFields = (userId: string | null, permissions: string | null): DevSessionForm | { readonly error: string } => {
    const trimmedUserId = (userId ?? '').trim();
    const trimmedPermissions = (permissions ?? '').trim();
    if (!trimmedUserId) {
      return { error: 'userId is required' };
    }
    return { userId: trimmedUserId, permissions: trimmedPermissions };
  };

  if (type === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams(raw);
    return userIdFromFields(params.get('userId'), params.get('permissions'));
  }

  if (!raw.trim()) {
    return { error: 'userId is required' };
  }

  try {
    const body = JSON.parse(raw) as { userId?: string; permissions?: string };
    return userIdFromFields(
      typeof body.userId === 'string' ? body.userId : null,
      typeof body.permissions === 'string' ? body.permissions : null,
    );
  } catch {
    return { error: 'Invalid JSON body' };
  }
};

const formatSetCookieHeader = (name: string, value: string): string => {
  const encoded = encodeURIComponent(value);
  return [
    `${name}=${encoded}`,
    `Path=${devSessionCookieOptions.path}`,
    `Max-Age=${devSessionCookieOptions.maxAge}`,
    `SameSite=${devSessionCookieOptions.sameSite}`,
  ].join('; ');
};

/**
 * Node `ServerResponse` に開発用セッション Cookie を付与する。
 */
export const appendDevSessionSetCookieHeaders = (
  res: ServerResponse,
  userId: string,
  permissions: string,
): void => {
  res.setHeader('Set-Cookie', [
    formatSetCookieHeader(HIKARI_USER_ID_COOKIE, userId),
    formatSetCookieHeader(HIKARI_PERMISSIONS_COOKIE, permissions),
  ]);
};

/**
 * 開発用セッション Cookie を設定してリダイレクトする。
 */
export const redirectWithDevSessionCookies = (
  res: ServerResponse,
  location: string,
  userId: string,
  permissions: string,
): void => {
  appendDevSessionSetCookieHeaders(res, userId, permissions);
  res.writeHead(303, { Location: location });
  res.end();
};

/**
 * 開発用 dev-session UI を有効にするか。
 * `HIKARI_DEV_SESSION=0` で無効化できる。
 */
export const isDevSessionEnabledByEnv = (): boolean =>
  process.env.HIKARI_DEV_SESSION !== '0';
