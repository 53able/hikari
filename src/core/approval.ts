import type { ExecutionContext } from './capability.js';

/** `requiresApproval: true` のケイパビリティ実行前に `ApprovalGate` へ渡されるリクエスト情報。 */
export interface ApprovalRequest {
  /** リクエストの一意ID（UUID）。 */
  id: string;
  /** 承認が必要なケイパビリティ名。 */
  capabilityName: string;
  /** Zodバリデーション済みの入力値。 */
  input: unknown;
  /** 呼び出し元のユーザー・セッション・権限情報。 */
  context: ExecutionContext;
  /** `describeRisk` が導出したリスク分類（例: `"financial"`, `"irreversible"`）。 */
  riskLevel: string;
  /** リクエストが生成された日時。 */
  requestedAt: Date;
}

/** `ApprovalGate` の戻り値。`approved` で許可/拒否を区別する判別ユニオン型。 */
export type ApprovalResult =
  | { approved: true; approvedBy: string; approvedAt: Date }
  | { approved: false; rejectedBy: string; rejectedAt: Date; reason?: string };

/**
 * ケイパビリティ実行前に呼ばれる承認ゲート関数型。
 * `{ approved: true }` を返すと実行を許可、`{ approved: false }` で `ApprovalDeniedError` をスローさせる。
 * 本番では実際のレビューワークフロー（Slack通知・管理画面など）をここに実装する。
 */
export type ApprovalGate = (request: ApprovalRequest) => Promise<ApprovalResult>;

/** サイレント自動承認ゲート。テスト専用。コンソール出力なし。 */
export const autoApprove: ApprovalGate = async (_req) => ({
  approved: true,
  approvedBy: 'auto',
  approvedAt: new Date(),
});

/**
 * 開発用自動承認ゲート。承認内容をコンソールに出力した後、自動で許可する。
 * 本番環境では絶対に使用しないこと — 人間によるレビューをバイパスする。
 */
export const devAutoApprove: ApprovalGate = async (req) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'devAutoApprove must not be used in production. Provide a real ApprovalGate implementation.',
    );
  }

  console.log('\n[APPROVAL REQUIRED — dev auto-approve]');
  console.log(`  Capability : ${req.capabilityName}`);
  console.log(`  Risk level : ${req.riskLevel}`);
  console.log(`  Input      : ${JSON.stringify(req.input, null, 2)}`);
  console.log('  → Auto-approving (NODE_ENV !== production)\n');
  return { approved: true, approvedBy: 'dev-auto', approvedAt: new Date() };
};

/**
 * インタラクティブなコンソール承認ゲート。標準入力で y/N を確認する。
 * TTY が必要。`NODE_ENV=production` では例外をスローする。
 */
export const consoleApprove: ApprovalGate = async (req) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'consoleApprove must not be used in production. Provide a real ApprovalGate implementation.',
    );
  }

  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\n[APPROVAL REQUIRED]');
    console.log(`  Capability : ${req.capabilityName}`);
    console.log(`  Risk level : ${req.riskLevel}`);
    console.log(`  Input      : ${JSON.stringify(req.input, null, 2)}`);
    const answer = (
      await rl.question('  Approve? [y/N] ')
    ).trim().toLowerCase();

    if (answer === 'y' || answer === 'yes') {
      return { approved: true, approvedBy: 'console-user', approvedAt: new Date() };
    }
    return {
      approved: false,
      rejectedBy: 'console-user',
      rejectedAt: new Date(),
      reason: 'denied at console',
    };
  } finally {
    rl.close();
  }
};

/** 承認ゲートが拒否を返したときにスローされる。HTTPアダプターは HTTP 409 にマップする。 */
export class ApprovalDeniedError extends Error {
  constructor(
    /** 拒否された承認リクエストのID。 */
    public readonly requestId: string,
    /** 承認が拒否されたケイパビリティ名。 */
    capabilityName: string,
    /** ゲートが返した拒否理由（省略可）。 */
    public readonly reason?: string,
  ) {
    super(`Approval denied for '${capabilityName}': ${reason ?? 'no reason given'}`);
    this.name = 'ApprovalDeniedError';
  }
}
