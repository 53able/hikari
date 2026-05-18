/** @jsx h */
import { h } from '../jsx/index.js';

/** `renderCapabilityDevSessionHtml` のオプション。 */
export type CapabilityDevSessionPageOptions = {
  readonly actionUrl: string;
  readonly listUrl: string;
  readonly defaultUserId?: string;
  readonly defaultPermissions?: string;
};

/**
 * 開発用: ブラウザに `hikari-user-id` / `hikari-permissions` Cookie を設定するフォーム HTML。
 */
export const renderCapabilityDevSessionHtml = (
  options: CapabilityDevSessionPageOptions,
): string => {
  const page = (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <title>Hikari — Dev session</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f1419; color: #e7ecf3; max-width: 36rem; }
h1 { font-size: 1.35rem; }
.muted { color: #94a3b8; line-height: 1.5; }
form { display: flex; flex-direction: column; gap: 1rem; margin-top: 1.5rem; }
label { font-weight: 600; }
input { padding: 0.5rem; border-radius: 6px; border: 1px solid #2a3441; background: #1a2332; color: #e7ecf3; }
button { padding: 0.5rem 1rem; border-radius: 6px; border: none; background: #2563eb; color: #fff; cursor: pointer; font-weight: 600; width: fit-content; }
a { color: #7dd3fc; }
code { color: #7dd3fc; }`,
          }}
        />
      </head>
      <body>
        <h1>Dev session (Cookie)</h1>
        <p class="muted">
          Browser forms cannot send <code>x-hikari-permissions</code> headers. Set cookies here
          for local testing (e.g. <code>admin</code> for <code>add_book</code>).
        </p>
        <form method="post" action={options.actionUrl}>
          <div>
            <label for="userId">User ID</label>
            <input
              id="userId"
              name="userId"
              type="text"
              value={options.defaultUserId ?? 'dev-user'}
              required
            />
          </div>
          <div>
            <label for="permissions">Permissions (comma-separated)</label>
            <input
              id="permissions"
              name="permissions"
              type="text"
              value={options.defaultPermissions ?? 'admin,purchase'}
              placeholder="admin,purchase"
            />
          </div>
          <button type="submit">Save cookies</button>
        </form>
        <p class="muted">
          <a href={options.listUrl}>All capabilities</a>
        </p>
      </body>
    </html>
  );
  return String(page);
};
