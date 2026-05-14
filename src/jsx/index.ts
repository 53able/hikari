/**
 * JSX ランタイム。`h()` と `Fragment` を提供するサーバーサイド HTML 生成ユーティリティ。
 *
 * `h()` は生成済みの HTML を `HtmlNode` でラップして返す。
 * `renderChild` は `HtmlNode` を素通り（再エスケープなし）し、生文字列のみ HTML エスケープする。
 */

/** レンダリング済みの HTML を保持するラッパー。再エスケープを防ぐ。 */
export class HtmlNode {
  constructor(public readonly value: string) {}
  toString(): string { return this.value; }
}

declare global {
  namespace JSX {
    type Element = HtmlNode;
    interface IntrinsicElements {
      [name: string]: Record<string, unknown>;
    }
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}

function escHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** 子ノードを HTML 文字列に変換する。`HtmlNode` は再エスケープしない。 */
function renderChild(child: unknown): string {
  if (child instanceof HtmlNode) return child.value;
  if (child === null || child === undefined || child === false) return '';
  if (typeof child === 'string') return escHtml(child);
  if (typeof child === 'number') return String(child);
  if (Array.isArray(child)) return child.map(renderChild).join('');
  return escHtml(String(child));
}

/** JSX ファクトリ関数。`tsconfig.json` の `"jsxFactory": "h"` と対応する。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function h(
  type: string | ((props: Record<string, unknown>) => HtmlNode),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): HtmlNode {
  const p = props ?? {};

  if (typeof type === 'function') {
    const childrenVal = children.length === 0
      ? p['children']
      : children.length === 1 ? children[0] : children;
    return type({ ...p, children: childrenVal });
  }

  const { dangerouslySetInnerHTML, children: _c, ...attrs } = p;

  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => {
      if (v === true) return ` ${k}`;
      const name = k === 'className' ? 'class' : k === 'htmlFor' ? 'for' : k;
      return ` ${name}="${escHtml(v)}"`;
    })
    .join('');

  if (VOID_ELEMENTS.has(type)) {
    return new HtmlNode(`<${type}${attrStr}>`);
  }

  const dsi = dangerouslySetInnerHTML as { __html: string } | undefined;
  const content = dsi ? dsi.__html : children.map(renderChild).join('');

  return new HtmlNode(`<${type}${attrStr}>${content}</${type}>`);
}

/** JSX フラグメント。`tsconfig.json` の `"jsxFragmentFactory": "Fragment"` と対応する。 */
export function Fragment({ children }: { children?: unknown }): HtmlNode {
  if (Array.isArray(children)) {
    return new HtmlNode(children.map(renderChild).join(''));
  }
  return new HtmlNode(renderChild(children));
}

/** JS 文字列リテラル内の特殊文字をエスケープする（script タグ内で変数を埋め込む際に使用）。 */
export function escJs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
