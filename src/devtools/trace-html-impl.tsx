import type { TraceSpan } from './trace-viewer.js';
import { renderTracePageHtml } from './trace-page.js';

/**
 * 複数の `TraceSpan` を静的 HTML ページとしてレンダリングする。
 * Tamagui SSR シェル + 共有 `tamagui.config.ts` を使用する。
 *
 * @param spans - 表示するトレーススパンの配列。
 * @param options - ページタイトルなどの設定。
 */
export const renderTraceHtml = (
  spans: TraceSpan[],
  options?: { title?: string },
): string => {
  const title = options?.title ?? 'Hikari Trace Viewer';
  return renderTracePageHtml(spans, title);
};
