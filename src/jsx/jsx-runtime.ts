/**
 * 将来 `jsx: react-jsx` + `jsxImportSource` に切り替える場合の自動ランタイム（`jsx` / `jsxs`）。
 * 現行は `jsxFactory: React.createElement` を既定とし、静的ページのみ `@jsx h` pragma を使う。
 */
export { h as jsx, h as jsxs, Fragment } from './index.js';
