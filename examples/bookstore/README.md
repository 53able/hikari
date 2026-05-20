# Bookstore — Hikari サンプルアプリ

Hikariフレームワークのコアコンセプトを示す書店在庫管理サンプル。  
`defineCapability` によるケイパビリティ定義から、ポリシー制御・監査ログ・AIエージェント統合まで一通り体験できます。

## ファイル構成

```
examples/bookstore/
├── capabilities.ts         # 書店在庫ケイパビリティ（5種）
├── registry.ts             # hikari serve / dev-invoke 用レジストリ
├── dev-invoke.ts           # API キー不要の capability smoke test CLI
├── invoice-capabilities.ts # 請求リマインド MVP ケイパビリティ（4種）
├── main.ts                 # エンジン直接実行デモ
├── main-pi.ts              # Pi AIエージェント統合デモ
└── main-flow.ts            # 請求リマインド記事 MVP フロー
```

## ケイパビリティ一覧（書店）

| 名前 | 説明 | 権限 | 承認 | Idempotency | 監査 |
|---|---|---|---|---|---|
| `list_books` | 全書籍一覧（タイトル・著者フィルタ対応） | なし | 不要 | 不要 | basic |
| `get_book` | 書籍ID指定で詳細取得 | なし | 不要 | 不要 | basic |
| `purchase_book` | 購入（在庫減算・課金） | `purchase` | **必要** | **必須** | full |
| `add_book` | 在庫への新規書籍追加 | `admin` | 不要 | **必須** | full |
| `delete_book` | 書籍の永久削除（不可逆） | `admin` | **必要** | **必須** | full |

## 請求リマインド MVP（`invoice-capabilities.ts`）

| 名前 | 説明 | Idempotency |
|---|---|---|
| `invoice_search_overdue` | 未払い請求の検索 | 不要 |
| `customer_get_contact` | 顧客連絡先の取得 | 不要 |
| `email_compose_reminder` | リマインドメール下書き作成 | **必須** |
| `email_send_reminder` | 承認後のメール送信 | **必須** |

## 実行方法

プロジェクトルートから実行します。

### Capability invoker (`dev-invoke.ts`)

API キー不要。`createCapabilityInvoker` 経由で単一ケイパビリティを JSON 出力する。

```bash
npx tsx examples/bookstore/dev-invoke.ts --list
npx tsx examples/bookstore/dev-invoke.ts list_books
npx tsx examples/bookstore/dev-invoke.ts get_book '{"bookId":"1"}'
```

`write` / `financial` 側のケイパビリティ（`purchase_book` など）は、invoker が `idempotencyKey` を渡せないため **この CLI では実行できません**。購入・削除のデモは [`main.ts`](main.ts) か [Hono サンプル](../hono-bookstore/README.md) の HTTP（`Idempotency-Key` ヘッダ）を使ってください。

### エンジン直接実行 (`main.ts`)

```bash
npm run example
# または
npx tsx examples/bookstore/main.ts
```

以下のデモを順に実行します：

1. **全書籍一覧** — 権限なしで読み取り
2. **著者フィルタ** — "David" を含む書籍を絞り込み
3. **購入** — `purchase` 権限＋`idempotencyKey`＋承認ゲート通過後に在庫減算
4. **権限エラー** — `idempotencyKey` を付けたうえで `admin` なしの削除を試し、`PolicyViolationError` を確認
5. **監査ログ** — traceIdで記録された全イベントを表示

### 請求リマインド MVP フロー (`main-flow.ts`)

```bash
npm run example:flow
# または
npx tsx examples/bookstore/main-flow.ts
```

`createHarnessTracer` + `buildHarnessPlan` で intent / plan を記録し、請求リマインド一連のケイパビリティをエンジン経由で実行します。

### Pi AIエージェント統合 (`main-pi.ts`)

```bash
npx tsx examples/bookstore/main-pi.ts
```

`createHikariHarness` で Pi ターン単位の intent / plan と engine 側の tool 監査を同一 `traceId` で記録します。  
自然言語のプロンプトからエージェントが適切なケイパビリティを選択・実行します。

`hikari serve` でチャット → 承認 → `/traces` を確認する手順:

1. `npx hikari serve --entry examples/bookstore/registry.ts`
2. チャットで `list_books` 相当の質問 → `purchase_book` を依頼
3. 承認キュー（`/approvals`）またはチャットの `/approve` / `/reject`
4. `/traces` で intent / plan steps / tool / approval が 1 本の trace に並ぶことを確認

> **前提**: `ANTHROPIC_API_KEY` 環境変数が必要です。

> **既知制限**: Pi / チャット経路（`main-pi.ts`、`hikari serve` の `/api/chat`）は、現状アダプターが `idempotencyKey` を自動付与しないため、`purchase_book` など write/financial のツール実行は `IdempotencyRequiredError` になり得ます。エンジン直接実行または HTTP の `Idempotency-Key` で確認してください。

## 学べること

| テーマ | 該当コード |
|---|---|
| `defineCapability` の基本構造 | `capabilities.ts` |
| `createRegistry` へのケイパビリティ登録 | `main.ts` |
| `devAutoApprove` による承認ゲートのモック | `main.ts` |
| harness trace + 動的プラン | `main-flow.ts` |
| `createHikariHarness` による Pi 正規ルート | `main-pi.ts` |
| `context.runtime` による決定論的ストア注入 | `capabilities.ts` + `createEngine({ runtime })` |
