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
| `defineCapability` | ケイパビリティのDSL（スキーマ＋ポリシー＋ハンドラ） |
| `CapabilityRegistry` | 全ケイパビリティの単一の定義源 |
| `PolicyEngine` | 権限チェック、承認要否の判定 |
| `AuditLog` | traceIdで意図から結果まで追跡 |
| `ApprovalGate` | human-in-the-loop（financial/irreversible操作） |
| `ExecutionEngine` | バリデーション→ポリシー→承認→実行→監査の全フロー |
| `ClaudeAdapter` | ケイパビリティをAnthropicツール仕様に変換 |

## クイックスタート

```typescript
import {
  defineCapability,
  CapabilityRegistry,
  AuditLog,
  InMemoryAuditStorage,
  ExecutionEngine,
  ConsoleApprovalGate,
} from 'hikari';
import { z } from 'zod';

// 1. ケイパビリティを定義
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

// 2. レジストリに登録
const registry = new CapabilityRegistry();
registry.register(greet);

// 3. エンジンを構築
const auditLog = new AuditLog(new InMemoryAuditStorage());
const engine = new ExecutionEngine(registry, auditLog);

// 4. 実行（バリデーション・ポリシーチェック・監査が自動で走る）
const result = await engine.execute('greet', { name: 'Alice' }, {
  userId: 'user-1',
  intent: 'Greet Alice',
});
console.log(result.output); // { message: 'Hello, Alice!' }
```

## ポリシーと副作用

```typescript
policy: {
  requiredPermissions: ['admin'],     // 必要な権限
  sideEffects: ['write', 'financial'], // 副作用の種類
  requiresApproval: true,             // 明示的な承認要求
  auditLevel: 'full',                 // 監査レベル
}
```

`financial` または `irreversible` な副作用を持つケイパビリティは、自動的に `ApprovalGate` を通過する。

## LLMとの連携（Claude）

```typescript
import { ClaudeAdapter } from 'hikari';

const adapter = new ClaudeAdapter(registry, engine);

// ケイパビリティをAnthropicツール仕様に自動変換
const result = await adapter.chat(
  [{ role: 'user', content: 'Greet Alice and Bob' }],
  { userId: 'user-1', permissions: [] },
);
console.log(result.content);
```

## 5つの設計原則

1. **プリミティブは小さく** — 1ケイパビリティ＝1操作
2. **すべての副作用にポリシー付与** — read/write/financial/irreversible/external
3. **トレース可能性** — traceIdで全操作を追跡
4. **ヒューマンインザループ** — 重要操作は人間の承認を挟む
5. **UIもケイパビリティから生成** — 単一定義源から複数インターフェース

## 開発

```bash
npm install
npm test          # テスト実行 (18 tests)
npm run lint      # 型チェック
npm run example   # Bookstoreサンプル実行
npm run build     # TypeScriptビルド
```

## ディレクトリ構成

```
src/
├── core/
│   ├── capability.ts   # Capability DSL & 型定義
│   ├── registry.ts     # CapabilityRegistry
│   ├── policy.ts       # PolicyEngine
│   ├── audit.ts        # AuditLog & InMemoryAuditStorage
│   ├── approval.ts     # ApprovalGate (Auto/Console実装付き)
│   └── execution.ts    # ExecutionEngine
└── adapters/
    └── claude.ts       # ClaudeAdapter (Anthropic SDK)
examples/
└── bookstore/          # CRUD + financial操作のサンプル
tests/                  # Vitest ユニットテスト
```
