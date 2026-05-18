/** @jsx h */
/** @jsxFrag Fragment */
import { h, HtmlNode } from '../jsx/index.js';

/** `renderCapabilityResultHtml` のオプション。 */
export type CapabilityResultPageOptions = {
  readonly capabilityName: string;
  readonly formUrl: string;
  readonly listUrl: string;
};

interface CapabilityResultPageProps {
  readonly capabilityName: string;
  readonly status: number;
  readonly body: unknown;
  readonly formUrl: string;
  readonly listUrl: string;
}

const CapabilityResultPage = ({
  capabilityName,
  status,
  body,
  formUrl,
  listUrl,
}: CapabilityResultPageProps): HtmlNode => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <title>{`Hikari — ${capabilityName} result`}</title>
      <style
        dangerouslySetInnerHTML={{
          __html: `body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f1419; color: #e7ecf3; max-width: 48rem; }
    h1 { font-size: 1.35rem; }
    .meta { color: #94a3b8; margin-bottom: 1rem; }
  pre { background: #1a2332; border: 1px solid #2a3441; border-radius: 8px; padding: 1rem; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    a { color: #7dd3fc; }
    .actions { display: flex; gap: 1rem; margin-top: 1.25rem; }`,
        }}
      />
    </head>
    <body>
      <h1>
        <code>{capabilityName}</code> — HTTP {String(status)}
      </h1>
      <p class="meta">Capability execution response</p>
      <pre>{JSON.stringify(body, null, 2)}</pre>
      <div class="actions">
        <a href={formUrl}>Back to form</a>
        <a href={listUrl}>All capabilities</a>
      </div>
    </body>
  </html>
);

/**
 * ケイパビリティ実行結果を表示する HTML ページを生成する。
 */
export const renderCapabilityResultHtml = (
  options: CapabilityResultPageOptions & {
    readonly status: number;
    readonly body: unknown;
  },
): string => {
  const page = (
    <CapabilityResultPage
      capabilityName={options.capabilityName}
      status={options.status}
      body={options.body}
      formUrl={options.formUrl}
      listUrl={options.listUrl}
    />
  );
  return `<!DOCTYPE html>\n${page.toString()}`;
};
