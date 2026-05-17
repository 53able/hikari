import type { ApprovalRequest } from './approval.js';

/** 承認 Webhook 通知関数。 */
export type ApprovalNotifier = (request: ApprovalRequest) => void;

/** `createApprovalWebhookNotifier` のオプション。 */
export type ApprovalWebhookNotifierOptions = {
  /** Webhook URL（通常は `HIKARI_APPROVAL_WEBHOOK_URL`）。 */
  readonly url: string;
  /** 追加 HTTP ヘッダー。 */
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetchFn?: typeof fetch;
  readonly logError?: (message: string, error: unknown) => void;
};

/** 汎用 Webhook JSON ペイロード。 */
export type ApprovalPendingWebhookPayload = {
  readonly type: 'approval.pending';
  readonly id: string;
  readonly capabilityName: string;
  readonly input: unknown;
  readonly riskLevel: string;
  readonly requestedAt: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly traceId: string;
};

const defaultLogError = (message: string, error: unknown): void => {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[hikari] ${message}: ${detail}`);
};

const toPayload = (request: ApprovalRequest): ApprovalPendingWebhookPayload => ({
  type: 'approval.pending',
  id: request.id,
  capabilityName: request.capabilityName,
  input: request.input,
  riskLevel: request.riskLevel,
  requestedAt: request.requestedAt.toISOString(),
  userId: request.context.userId,
  sessionId: request.context.sessionId,
  traceId: request.context.traceId,
});

const postJson = async (
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
  logError: (message: string, error: unknown) => void,
  label: string,
): Promise<void> => {
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${label} HTTP ${response.status}`);
    }
  } catch (error) {
    logError(`${label} failed`, error);
  }
};

/**
 * 承認 pending 時に汎用 JSON を HTTP POST する通知関数を生成する。
 * ネットワーク失敗はログのみ（ゲート処理は継続）。
 */
export const createApprovalWebhookNotifier = (
  options: ApprovalWebhookNotifierOptions,
): ApprovalNotifier => {
  const { url, headers = {}, fetchFn = fetch, logError = defaultLogError } = options;

  return (request) => {
    void postJson(
      fetchFn,
      url,
      toPayload(request),
      logError,
      'approval webhook',
    ).catch(() => undefined);
  };
};

/** `HIKARI_SLACK_WEBHOOK_URL` 向け Slack blocks 付き通知。 */
export const createSlackApprovalWebhookNotifier = (
  options: Omit<ApprovalWebhookNotifierOptions, 'headers'>,
): ApprovalNotifier => {
  const { url, fetchFn = fetch, logError = defaultLogError } = options;

  return (request) => {
    const payload = toPayload(request);
    void postJson(
      fetchFn,
      url,
      {
        type: 'approval.pending',
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: 'Hikari approval required', emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Capability*\n${payload.capabilityName}` },
              { type: 'mrkdwn', text: `*Risk*\n${payload.riskLevel}` },
              { type: 'mrkdwn', text: `*Request ID*\n${payload.id}` },
              { type: 'mrkdwn', text: `*Trace*\n${payload.traceId}` },
            ],
          },
        ],
        approval: payload,
      },
      logError,
      'Slack approval webhook',
    ).catch(() => undefined);
  };
};

/** 複数の `ApprovalNotifier` を合成する。 */
export const composeApprovalNotifiers = (
  ...notifiers: readonly ApprovalNotifier[]
): ApprovalNotifier => (request) => {
  for (const notify of notifiers) {
    notify(request);
  }
};

/**
 * 環境変数から承認 Webhook 通知関数の配列を構築する。
 * - `HIKARI_APPROVAL_WEBHOOK_URL` — 汎用 JSON
 * - `HIKARI_SLACK_WEBHOOK_URL` — Slack Incoming Webhook
 */
export const approvalNotifiersFromEnv = (
  options: Pick<ApprovalWebhookNotifierOptions, 'fetchFn' | 'logError'> = {},
): readonly ApprovalNotifier[] => {
  const notifiers: ApprovalNotifier[] = [];
  const genericUrl = process.env.HIKARI_APPROVAL_WEBHOOK_URL?.trim();
  if (genericUrl) {
    notifiers.push(createApprovalWebhookNotifier({ url: genericUrl, ...options }));
  }
  const slackUrl = process.env.HIKARI_SLACK_WEBHOOK_URL?.trim();
  if (slackUrl) {
    notifiers.push(createSlackApprovalWebhookNotifier({ url: slackUrl, ...options }));
  }
  return notifiers;
};

/**
 * 環境変数 `HIKARI_APPROVAL_WEBHOOK_URL` が設定されていれば Webhook 通知関数を返す。
 * @deprecated `approvalNotifiersFromEnv` を使用してください。
 */
export const approvalWebhookFromEnv = (): ApprovalNotifier | undefined => {
  const notifiers = approvalNotifiersFromEnv();
  if (notifiers.length === 0) return undefined;
  return composeApprovalNotifiers(...notifiers);
};
