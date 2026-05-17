import type { ApprovalNotifier } from './approval-webhook.js';

/** `createQueuedApprovalNotifier` のオプション。 */
export type QueuedApprovalNotifierOptions = {
  /** 失敗時の最大再試行回数（初回を含めない追加試行）。デフォルト: 2。 */
  readonly maxRetries?: number;
  /** 再試行の基準待機（ミリ秒）。指数バックオフの基数。デフォルト: 500。 */
  readonly retryDelayMs?: number;
  readonly logError?: (message: string, error: unknown) => void;
};

type QueueJob = {
  readonly notifier: ApprovalNotifier;
  readonly request: Parameters<ApprovalNotifier>[0];
  readonly attempt: number;
};

const defaultLogError = (message: string, error: unknown): void => {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[hikari] ${message}: ${detail}`);
};

/**
 * 承認 Webhook 通知をプロセス内キューで直列化し、失敗時に指数バックオフで再試行する。
 * ネットワーク失敗でもゲート処理は継続（fail-open）。本番 DLQ は将来拡張。
 */
export const createQueuedApprovalNotifier = (
  inner: ApprovalNotifier,
  options: QueuedApprovalNotifierOptions = {},
): ApprovalNotifier => {
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const logError = options.logError ?? defaultLogError;
  const queue: QueueJob[] = [];
  let draining = false;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const runJob = async (job: QueueJob): Promise<void> => {
    try {
      job.notifier(job.request);
    } catch (error) {
      if (job.attempt < maxRetries) {
        const delay = retryDelayMs * 2 ** job.attempt;
        await sleep(delay);
        queue.push({ ...job, attempt: job.attempt + 1 });
        return;
      }
      logError('queued approval notifier failed after retries', error);
    }
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) break;
      await runJob(job);
    }
    draining = false;
  };

  return (request) => {
    queue.push({ notifier: inner, request, attempt: 0 });
    void drain();
  };
};
