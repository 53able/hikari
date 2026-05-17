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
| `createClaudeAdapter` / `createHikariAgent` | レジストリからツール定義を自動生成 |
| `createHttpAdapter` | 同一レジストリから REST API を派生 |
| `createCapabilityExplorer` / `createTraceViewer` | devtools |

## クイックスタート

```typescript
import {
  defineCapability,
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  devAutoApprove,
} from 'hikari';
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
import { policy } from 'hikari';

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
import { createClaudeAdapter } from 'hikari';

const adapter = createClaudeAdapter(registry, engine);
const result = await adapter.chat(
  [{ role: 'user', content: 'Greet Alice' }],
  { userId: 'user-1', permissions: [] },
);
```

### Pi harness

```typescript
import { createHikariAgentWithOptions, createHarnessTracer } from 'hikari';

const harness = createHarnessTracer(auditLog);
const agent = createHikariAgentWithOptions(
  registry,
  engine,
  { userId: 'user-1', permissions: ['purchase'], traceId: crypto.randomUUID() },
  { harness },
);
await agent.prompt('List books in stock');
```

Pi は agent control plane（計画・ツール選択）を担い、副作用の実行は Hikari エンジンが決定論的に処理する。`hikari serve` は Pi チャット UI を提供する。

> RPC / SDK によるリモート呼び出しは未実装。HTTP アダプターとチャット UI を利用してください。

## 記事 MVP フロー（請求リマインド）

```bash
npx tsx examples/bookstore/main-flow.ts
```

未払い請求の検索 → 連絡先取得 → メール下書き → 承認 → 送信 → trace 表示までをコードで再現する。

## 5つの設計原則

1. **プリミティブは小さく** — 1ケイパビリティ＝1操作
2. **すべての副作用にポリシー付与** — read/write/financial/irreversible/external
3. **トレース可能性** — traceId + harness（intent/plan/tool）+ 監査ログ
4. **ヒューマンインザループ** — 重要操作は人間の承認を挟む
5. **UIもケイパビリティから生成** — 単一定義源から HTTP・ツール・devtools を派生

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
├── devtools/
│   ├── trace-viewer.ts
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
