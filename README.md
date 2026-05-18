# Hikari

> AI-native application layer — WebアプリをLLMが安全に呼べる**ケイパビリティの集合**として設計する。

Zennの記事「[AI-Native Webアプリケーションの設計思想](https://zenn.dev/53able/articles/5e32c6e5a4b511)」の構想をTypeScriptで実装したフレームワーク。

## 設計思想

従来のWebアプリは「ルート → コントローラ → サービス → DB」という設計。
HikariはLLMが主体的に操作することを前提に、**ケイパビリティ**という単位で操作を定義する。

```
意図の解釈 → ケイパビリティ選択 → 決定論的実行 → 監査記録
   (LLM)         (LLM)           (Hikari)       (Hikari)
```

UIとLLMエージェントの**両方が同じレジストリを共有**するため、定義の重複がない。

## コアコンセプト

| コンポーネント | 役割 |
|---|---|
| `defineCapability` / `capability` | ケイパビリティのDSL（スキーマ＋ポリシー＋ハンドラ） |
| `createRegistry` | 全ケイパビリティの単一の定義源 |
| `policy` / `evaluatePolicy` | 権限チェック、条件付き承認（`requiresApprovalWhen`） |
| `createAuditLog` | traceIdで意図から結果まで追跡 |
| `createHarnessTracer` | intent / plan / tool 選択の harness 層ログ |
| `createEngine` | バリデーション→ポリシー→承認→実行→監査の全フロー |
| `createClaudeAdapter` / `createOpenAiAdapter` / `createHikariAgent` | レジストリからツール定義を自動生成 |
| `createHttpAdapter` / `mountHikariHttpAdapter` | 同一レジストリから REST API を派生（Hono 統合は optional peer） |
| `mountHikariCapabilityUi` / `createCapabilityUiHandlers` | レジストリから一覧・入力フォーム HTML を投影（Hono / `hikari serve` 共有） |
| `createHikariExecutionOptionsMiddleware` | Hono `Variables` に `ExecutionOptions` を載せる認証ブリッジ |
| `mountHikariTraceViewer` / `mountHikariApprovals` / `mountHikariChat` | 監査トレース・承認キュー・JSON チャットの Hono マウント |
| `normalizeExecutionOptions` | `permissions` 等を正規化（`?? []` を利用側に書かせない） |
| `resolveLlmFromEnv` / `resolveServeChatBackend` | 環境変数から LLM バックエンドを選択 |
| `createCapabilityExplorer` / `createTraceViewer` | devtools |

## インストール

```bash
npm install @53able/hikari@beta
```

## クイックスタート

```typescript
import {
  defineCapability,
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  devAutoApprove,
} from '@53able/hikari';
import { z } from 'zod';

const greet = defineCapability({
  name: 'greet',
  description: 'Greet a user by name',
  inputSchema: z.object({ name: z.string() }),
  outputSchema: z.object({ message: z.string() }),
  policy: {
    requiredPermissions: [],
    sideEffects: ['read'],
    auditLevel: 'basic',
  },
  async handler({ name }) {
    return { message: `Hello, ${name}!` };
  },
});

const registry = createRegistry().register(greet);
const auditLog = createAuditLog(createInMemoryStorage());
const engine = createEngine({ registry, auditLog, approvalGate: devAutoApprove });

const result = await engine.execute('greet', { name: 'Alice' }, {
  userId: 'user-1',
  intent: 'Greet Alice',
});
console.log(result.output); // { message: 'Hello, Alice!' }
```

## ポリシーと副作用

```typescript
import { policy } from '@53able/hikari';

policy: {
  ...policy.role('accounting'),
  sideEffects: ['write', 'financial'],
  requiresApproval: true,
  ...policy.requiresApprovalWhen((input) => input.amount > 100_000),
  auditLevel: 'full',
}
```

`financial` / `irreversible` 副作用、明示的 `requiresApproval`、または `requiresApprovalWhen` が真のときに `ApprovalGate` を通過する。

## LLMとの連携

### Claude

```typescript
import { createClaudeAdapter } from '@53able/hikari';

const adapter = createClaudeAdapter(registry, engine);
const result = await adapter.chat(
  [{ role: 'user', content: 'Greet Alice' }],
  { userId: 'user-1', permissions: [] },
);
```

### OpenAI

```typescript
import { createOpenAiAdapter } from '@53able/hikari';

const adapter = createOpenAiAdapter(registry, engine);
const result = await adapter.chat(
  [{ role: 'user', content: 'Greet Alice' }],
  { userId: 'user-1', permissions: [] },
);
```

### Pi harness

```typescript
import { createHikariAgentWithOptions, createHarnessTracer } from '@53able/hikari';

const harness = createHarnessTracer(auditLog);
const agent = createHikariAgentWithOptions(
  registry,
  engine,
  { userId: 'user-1', permissions: ['purchase'], traceId: crypto.randomUUID() },
  { harness },
);
await agent.prompt('List books in stock');
```

Pi は agent control plane（計画・ツール選択）を担い、副作用の実行は Hikari エンジンが決定論的に処理する。`hikari serve` は既定で Pi チャット UI を提供する（`LLM_PROVIDER` で Claude / OpenAI に切り替え可能）。

### `hikari serve` の LLM バックエンド

| `LLM_PROVIDER` | 動作 |
|---|---|
| `pi`（既定） | Pi harness + Hikari エンジン |
| `anthropic` | `createClaudeAdapter`（`ANTHROPIC_API_KEY` 必須） |
| `openai` | `createOpenAiAdapter`（`OPENAI_API_KEY` 必須） |
| `auto` | Anthropic キーがあれば Pi、なければ OpenAI |

チャット専用 API（自前 HTTP サーバー）では `resolveLlmFromEnv(registry, engine)` を使う。`anthropic` / `openai` / `auto`（両方キーがある場合は anthropic）。

### Hono へのマウント

`hono` と `@hono/node-server` は optional peer です。

```typescript
import { Hono } from 'hono';
import {
  createHttpAdapter,
  createHeaderExecutionOptionsResolver,
  createHikariExecutionOptionsMiddleware,
  mountHikariHttpAdapter,
  mountHikariCapabilityUi,
  mountHikariTraceViewer,
  mountHikariApprovals,
  type HikariHonoEnv,
} from '@53able/hikari';

const resolveExecutionOptions = createHeaderExecutionOptionsResolver({
  readCookies: true,
});
const httpAdapter = createHttpAdapter(registry, engine, {
  basePath: '/api',
  resolveExecutionOptions,
  capabilityResultHtml: { uiBasePath: '/capabilities' },
});

const app = mountHikariCapabilityUi(
  mountHikariHttpAdapter(
    mountHikariApprovals(
      mountHikariTraceViewer(
        new Hono<HikariHonoEnv>()
          .use('/api/*', createHikariExecutionOptionsMiddleware(resolveExecutionOptions))
          .use('/approvals/*', createHikariExecutionOptionsMiddleware(resolveExecutionOptions)),
        { storage: auditStorage },
      ),
      { approvals: approvalApi },
    ),
    httpAdapter,
    { basePath: '/api' },
  ),
  {
    registry,
    apiBasePath: '/api',
    uiBasePath: '/capabilities',
    enableDevSession: true,
  },
);
```

| ルート（Hono） | 内容 |
|---|---|
| `GET /capabilities` | ケイパビリティ探索 HTML（`CapabilityMeta` から生成） |
| `GET /capabilities/dev-session` | 開発用 Cookie セッション（`enableDevSession` 時・本番では無効化） |
| `GET /capabilities/:name/form` | 入力フォーム HTML（Zod スキーマからフィールド生成） |
| `POST /api/capabilities/:name` | 実行（urlencoded / JSON）。`Accept: text/html` で結果 HTML |
| `GET /traces` | 監査トレース HTML（`mountHikariTraceViewer`） |
| `GET /approvals` | 承認キュー HTML（`mountHikariApprovals` + 承認ストア） |

ブラウザから `admin` 権限が必要なケイパビリティ（例: `add_book`）を試す場合は、先に `GET /capabilities/dev-session` で User ID と Permissions（例: `admin`）を Cookie に保存する。curl では `-H 'x-hikari-permissions: admin'` でも可。

参照実装: [`examples/hono-bookstore/`](examples/hono-bookstore/)

`hikari serve` の永続化・通知フラグ: `--audit-file <path>`（監査 JSONL）、`--approval-file <path>`（承認キュー JSON）、`--idempotency-file <path>`（冪等 JSONL）。複数インスタンス向けに Redis バックエンド: `--idempotency-redis`、`--approval-redis`、`--rate-limit-redis`（`REDIS_URL` または `--redis-url`）。Webhook は `HIKARI_APPROVAL_WEBHOOK_URL` / `HIKARI_SLACK_WEBHOOK_URL`（失敗時も実行は継続、プロセス内キューで再試行）。

`hikari serve` では同一プロセスで次も利用できる:

| ルート | 内容 |
|---|---|
| `/` | チャット UI（Tamagui SSR シェル） |
| `/traces` | 監査トレース HTML（harness / capability を分離表示） |
| `/capabilities` | ケイパビリティ探索 HTML |
| `/capabilities/dev-session` | 開発用 Cookie セッション（`HIKARI_DEV_SESSION=0` で無効） |
| `/capabilities/:name/form` | ケイパビリティ入力フォーム HTML |
| `/approvals` | 承認キュー HTML（`--approval-queue` または本番時） |
| `/approvals/pending` | 承認待ち JSON |
| `/api/capabilities` | REST 実行 API（`createHttpAdapter`） |
| `/api/openapi.json` | OpenAPI 3.0（cap-meta から生成） |

`hikari serve` は開発向けに Cookie から権限を読み取り（`readCookies`）、フォーム POST の HTML 結果ページと dev-session を有効にする。`admin` 権限のケイパビリティをブラウザから試すときは `http://127.0.0.1:3000/capabilities/dev-session` を開いてからフォームを実行する。

`hikari serve` の主なフラグ:

| フラグ | 説明 |
|---|---|
| `--port` | 待ち受けポート（デフォルト 3000） |
| `--entry` | レジストリ読み込みエントリ（デフォルト `src/index.ts`） |
| `--approval-queue` | インメモリ承認キューを有効化（開発でも human-in-the-loop） |
| `--audit-file <path>` | 監査ログを JSONL へ永続化 |
| `--approval-file <path>` | 承認キューを JSON へ永続化（キュー有効化も兼ねる） |
| `--approval-log-file <path>` | 承認イベントを JSONL へ追記（状態ファイルとは別） |
| `--idempotency-file <path>` | 冪等キー結果を JSONL へ永続化 |
| `--redis-url <url>` | Redis 接続 URL（デフォルト `REDIS_URL` または `redis://127.0.0.1:6379`） |
| `--idempotency-redis` | 冪等ストアを Redis に（分散 `hikari serve`） |
| `--approval-redis` | 承認キューを Redis に（ファイル監視不要） |
| `--rate-limit-redis` | レート制限を Redis スライディングウィンドウに |

環境変数 `HIKARI_DEV_SESSION=0` で dev-session UI と Cookie 読み取りを無効化できる（本番向け）。

環境変数（承認・認証・レート制限）:

| 変数 | 説明 |
|---|---|
| `HIKARI_APPROVAL_WEBHOOK_URL` | pending 時に JSON (`approval.pending`) を POST |
| `HIKARI_SLACK_WEBHOOK_URL` | Slack Incoming Webhook（blocks 付き） |
| `HIKARI_JWT_SECRET` | `Authorization: Bearer` の HMAC JWT 検証 |
| `HIKARI_RATE_LIMIT_*` | IP / user / capability 単位のレート制限（`createDefaultRateLimitGuard`） |
| `REDIS_URL` | Redis 接続（`--*-redis` フラグ利用時） |
| `HIKARI_RATE_LIMIT_REDIS` | `1` で `hikari serve` のレート制限を Redis に（`--rate-limit-redis` と同等） |
| `ANTHROPIC_API_KEY` | Claude / Pi 用 API キー |
| `OPENAI_API_KEY` | OpenAI Chat Completions 用 API キー |
| `LLM_PROVIDER` | `pi` / `anthropic` / `openai` / `auto`（serve 既定は `pi`） |
| `x-hikari-user-id` / `x-hikari-permissions` | 開発用 HTTP ヘッダー（`createHeaderExecutionOptionsResolver`） |

同一 Redis で 2 つの `hikari serve` を並べる例:

```bash
REDIS_URL=redis://127.0.0.1:6379 npx hikari serve --port 3000 --approval-redis --idempotency-redis --rate-limit-redis &
REDIS_URL=redis://127.0.0.1:6379 npx hikari serve --port 3001 --approval-redis --idempotency-redis --rate-limit-redis &
```

> RPC / SDK によるリモート呼び出しは未実装。HTTP アダプターとチャット UI を利用してください。

## 記事 MVP フロー（請求リマインド）

```bash
npm run example:flow
# または
npx tsx examples/bookstore/main-flow.ts
```

未払い請求の検索 → 連絡先取得 → メール下書き → 承認 → 送信 → trace 表示までをコードで再現する。

## 5つの設計原則

1. **プリミティブは小さく** — 1ケイパビリティ＝1操作
2. **すべての副作用にポリシー付与** — read/write/financial/irreversible/external
3. **トレース可能性** — traceId + harness（intent/plan/tool）+ 監査ログ
4. **ヒューマンインザループ** — 重要操作は人間の承認を挟む
5. **UIもケイパビリティから生成** — 単一定義源から HTTP・ツール・devtools を派生

## TSX と JSX ランタイム

サーバー描画ページは **TSX** で書く。ランタイムは用途で二系統ある。

| 用途 | ランタイム | 例 |
|---|---|---|
| 静的 HTML（フォーム・素の DOM） | `src/jsx` の `h` / `Fragment` / `HtmlNode`（ファイル先頭に `@jsx h` pragma） | `/capabilities/:name/form` |
| Tamagui シェル + テーブル等 | React（`tsconfig` 既定の `jsxFactory: React.createElement`）+ `renderToStaticMarkup` | `/`, `/traces`, `/approvals` |

新規の静的ページは `cap-form-page.tsx` と同様に、先頭に `/** @jsx h */` / `/** @jsxFrag Fragment */` と `import { h, Fragment } from '../jsx/index.js'` を付けて TSX を書く。Tamagui ページは `import React from 'react'` のうえで通常の TSX でよい。

## 開発

```bash
npm install
npm test
npm run lint
npm run example          # Bookstore CRUD サンプル
npx tsx examples/bookstore/main-flow.ts   # 請求リマインド MVP
npm run build
```

## ディレクトリ構成

```
src/
├── core/
│   ├── capability.ts      # DSL & 型
│   ├── registry.ts        # レジストリ
│   ├── policy.ts          # ポリシーエンジン
│   ├── cap-meta.ts        # メタデータ派生（HTTP/devtools）
│   ├── harness-trace.ts   # intent/plan/tool ログ
│   ├── audit.ts
│   ├── approval.ts
│   └── execution.ts
├── adapters/
│   ├── claude.ts
│   ├── pi.ts
│   └── http.ts
├── jsx/
│   ├── index.ts           # h / Fragment / HtmlNode
│   └── jsx-runtime.ts     # react-jsx 自動ランタイム
├── web/
│   ├── chat-page.tsx      # Tamagui（React pragma）
│   ├── cap-form-page.tsx  # 静的フォーム（h ランタイム）
│   └── approval-page.tsx
├── devtools/
│   ├── trace-viewer.ts
│   ├── trace-page.tsx
│   └── cap-explorer.ts
└── agent/
    └── session.ts
examples/
└── bookstore/
    ├── capabilities.ts
    ├── invoice-capabilities.ts
    ├── main.ts
    ├── main-pi.ts
    └── main-flow.ts
tests/
```
