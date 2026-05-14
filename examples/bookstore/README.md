# Bookstore — Hikari サンプルアプリ

Hikariフレームワークのコアコンセプトを示す書店在庫管理サンプル。  
`defineCapability` によるケイパビリティ定義から、ポリシー制御・監査ログ・AIエージェント統合まで一通り体験できます。

## ファイル構成

```
examples/bookstore/
├── capabilities.ts   # ケイパビリティ定義（5種）
├── main.ts           # エンジン直接実行デモ
└── main-pi.ts        # Pi AIエージェント統合デモ
```

## ケイパビリティ一覧

| 名前 | 説明 | 権限 | 承認 | 監査 |
|---|---|---|---|---|
| `list_books` | 全書籍一覧（タイトル・著者フィルタ対応） | なし | 不要 | basic |
| `get_book` | 書籍ID指定で詳細取得 | なし | 不要 | basic |
| `purchase_book` | 購入（在庫減算・課金） | `purchase` | **必要** | full |
| `add_book` | 在庫への新規書籍追加 | `admin` | 不要 | full |
| `delete_book` | 書籍の永久削除（不可逆） | `admin` | **必要** | full |

### ポリシーの読み方

```typescript
policy: {
  requiredPermissions: ['purchase'],  // 実行に必要な権限
  sideEffects: ['write', 'financial'], // financial → requiresApproval が自動で true
  requiresApproval: true,             // human-in-the-loop
  auditLevel: 'full',                 // 全イベントを監査ログに記録
}
```

## 実行方法

プロジェクトルートから実行します。

### エンジン直接実行 (`main.ts`)

```bash
npm run example
# または
npx tsx examples/bookstore/main.ts
```

以下のデモを順に実行します：

1. **全書籍一覧** — 権限なしで読み取り
2. **著者フィルタ** — "David" を含む書籍を絞り込み
3. **購入** — `purchase` 権限＋承認ゲート通過後に在庫減算
4. **権限エラー** — `admin` なしで削除を試みて `PolicyViolationError` を確認
5. **監査ログ** — traceIdで記録された全イベントを表示

```
═══════════════════════════════════════
  Hikari Bookstore — AI-Native Example
═══════════════════════════════════════

Registered capabilities:
  • list_books       List all books in the inventory, optional...
  • get_book         Get details for a specific book by its ID
  ...

1. Listing all books…
   [Clean Code] by Robert C. Martin — $29.99 (stock: 5)
   [The Pragmatic Programmer] by David Thomas — $34.99 (stock: 3)
   [Design Patterns] by GoF — $44.99 (stock: 2)
```

### Pi AIエージェント統合 (`main-pi.ts`)

```bash
npx tsx examples/bookstore/main-pi.ts
```

`createHikariAgent` でケイパビリティをAIエージェントのツールとして公開します。  
自然言語のプロンプトからエージェントが適切なケイパビリティを選択・実行します。

```
User: What books do you have in stock?
  → calling list_books({})
  ← list_books done
Assistant: We have 3 books in stock: ...

User: Buy 1 copy of Clean Code for me.
  → calling get_book({"bookId":"1"})
  ← get_book done
  → calling purchase_book({"bookId":"1","quantity":1})
  ← purchase_book done
Assistant: Purchased 1× "Clean Code" for $29.99 ...
```

> **前提**: `ANTHROPIC_API_KEY` 環境変数が必要です。

## 学べること

| テーマ | 該当コード |
|---|---|
| `defineCapability` の基本構造 | `capabilities.ts` |
| `createRegistry` へのケイパビリティ登録 | `main.ts:11-16` |
| `devAutoApprove` による承認ゲートのモック | `main.ts:20` |
| `PolicyViolationError` のハンドリング | `main.ts:70-78` |
| 監査ログの読み取り (`storage.getAll()`) | `main.ts:83-88` |
| `createHikariAgent` によるAIエージェント統合 | `main-pi.ts:22-27` |
| `agent.subscribe()` によるイベント監視 | `main-pi.ts:34-51` |
