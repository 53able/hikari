/**
 * クライアントが HTML レスポンスを期待しているか（`Accept: text/html` 等）。
 */
export const wantsHtmlResponse = (req: Request): boolean => {
  const accept = req.headers.get('accept') ?? '';
  return accept.includes('text/html');
};

/**
 * 承認アクション POST のボディをパースする（JSON または urlencoded）。
 */
export const parseApprovalActionBody = (
  raw: string,
  contentType: string | undefined,
): { by?: string; reason?: string } => {
  if (!raw.trim()) {
    return {};
  }
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (type === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams(raw);
    return {
      by: params.get('by') ?? undefined,
      reason: params.get('reason') ?? undefined,
    };
  }
  return JSON.parse(raw) as { by?: string; reason?: string };
};
