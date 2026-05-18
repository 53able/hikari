/** @jsx h */
/** @jsxFrag Fragment */
import type { CapabilityMeta } from '../core/cap-meta.js';
import { Fragment, h, HtmlNode } from '../jsx/index.js';
import { fieldsFromCapabilityMeta, type CapFormField } from './cap-form-schema.js';

const inputTypeForField = (field: CapFormField): string => {
  if (field.enumValues && field.enumValues.length > 0) return 'select';
  if (field.type === 'boolean') return 'checkbox';
  if (field.type === 'integer' || field.type === 'number') return 'number';
  if (field.type === 'array' || field.type === 'object') return 'textarea';
  return 'text';
};

const FieldControl = ({ field }: { field: CapFormField }): HtmlNode => {
  const id = field.name;
  const label = field.name;
  const desc = field.description ? (
    <p class="field-desc">{field.description}</p>
  ) : null;

  const kind = inputTypeForField(field);
  if (kind === 'select' && field.enumValues) {
    return (
      <>
        <label for={id}>
          {label}
          {field.required ? ' *' : ''}
        </label>
        {desc}
        <select id={id} name={id} required={field.required || undefined}>
          {field.enumValues.map((value) => (
            <option value={value}>{value}</option>
          ))}
        </select>
      </>
    );
  }
  if (kind === 'checkbox') {
    return (
      <>
        <label class="checkbox-row">
          <input type="checkbox" id={id} name={id} value="true" /> {label}
        </label>
        {desc}
      </>
    );
  }
  if (kind === 'textarea') {
    return (
      <>
        <label for={id}>
          {label}
          {field.required ? ' *' : ''}
        </label>
        {desc}
        <textarea id={id} name={id} rows={4} placeholder="JSON" required={field.required || undefined} />
      </>
    );
  }
  if (kind === 'number') {
    return (
      <>
        <label for={id}>
          {label}
          {field.required ? ' *' : ''}
        </label>
        {desc}
        <input
          type="number"
          id={id}
          name={id}
          step={field.type === 'integer' ? '1' : undefined}
          required={field.required || undefined}
        />
      </>
    );
  }
  return (
    <>
      <label for={id}>
        {label}
        {field.required ? ' *' : ''}
      </label>
      {desc}
      <input type="text" id={id} name={id} required={field.required || undefined} />
    </>
  );
};

/** `renderCapabilityFormHtml` のオプション。 */
export type CapabilityFormPageOptions = {
  /** POST 先（省略時は `/api/capabilities/:name`）。 */
  readonly actionUrl?: string;
  /** 戻るリンク先。 */
  readonly listUrl?: string;
  /** 開発用 Cookie セッション設定ページ（ブラウザ向け権限）。 */
  readonly devSessionUrl?: string;
};

interface CapabilityFormPageProps {
  readonly meta: CapabilityMeta;
  readonly actionUrl: string;
  readonly listUrl: string;
  readonly devSessionUrl?: string;
  readonly fields: readonly CapFormField[];
}

const PolicyNotice = ({
  meta,
  devSessionUrl,
}: {
  meta: CapabilityMeta;
  devSessionUrl?: string;
}): HtmlNode | null => {
  const perms = meta.policy.requiredPermissions;
  if (perms.length === 0) {
    return null;
  }
  return (
    <p class="policy-notice">
      Required permissions: <code>{perms.join(', ')}</code>. Browser forms use cookies unless
      headers are sent.
      {devSessionUrl ? (
        <>
          {' '}
          <a href={devSessionUrl}>Set dev session cookies</a>
        </>
      ) : null}
    </p>
  );
};

const CapabilityFormPage = ({
  meta,
  actionUrl,
  listUrl,
  devSessionUrl,
  fields,
}: CapabilityFormPageProps): HtmlNode => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <title>{`Hikari — ${meta.name}`}</title>
      <style
        dangerouslySetInnerHTML={{
          __html: `body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f1419; color: #e7ecf3; max-width: 40rem; }
    h1 { font-size: 1.35rem; }
    .meta { color: #94a3b8; margin-bottom: 1.5rem; }
    form { display: flex; flex-direction: column; gap: 1rem; }
    .field label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
    .field-desc { margin: 0 0 0.35rem; font-size: 0.85rem; color: #94a3b8; }
    input, select, textarea { width: 100%; padding: 0.5rem; border-radius: 6px; border: 1px solid #2a3441; background: #1a2332; color: #e7ecf3; box-sizing: border-box; }
    .checkbox-row { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; }
    .checkbox-row input { width: auto; }
    .actions { display: flex; gap: 0.75rem; align-items: center; margin-top: 0.5rem; }
    button { padding: 0.5rem 1rem; border-radius: 6px; border: none; background: #2563eb; color: #fff; cursor: pointer; font-weight: 600; }
    a { color: #7dd3fc; }
    .muted { color: #94a3b8; }
    .policy-notice { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.9rem; line-height: 1.5; }
    code { color: #7dd3fc; }`,
        }}
      />
    </head>
    <body>
      <h1>
        <code>{meta.name}</code>
      </h1>
      <p class="meta">{meta.description}</p>
      <PolicyNotice meta={meta} devSessionUrl={devSessionUrl} />
      <form method="post" action={actionUrl}>
        {fields.length > 0 ? (
          fields.map((field) => (
            <div class="field">
              <FieldControl field={field} />
            </div>
          ))
        ) : (
          <p class="muted">No input properties (empty object schema).</p>
        )}
        <div class="actions">
          <button type="submit">Execute (POST)</button>
          <a href={listUrl}>All capabilities</a>
        </div>
      </form>
      <p class="muted">
        Submits to the REST API (urlencoded or JSON). With Accept: text/html, results render as an HTML page.
      </p>
    </body>
  </html>
);

/**
 * ケイパビリティ入力用の最小 HTML フォームを生成する。
 */
export const renderCapabilityFormHtml = (
  meta: CapabilityMeta,
  options: CapabilityFormPageOptions = {},
): string => {
  const fields = fieldsFromCapabilityMeta(meta);
  const actionUrl = options.actionUrl ?? `/api/capabilities/${encodeURIComponent(meta.name)}`;
  const listUrl = options.listUrl ?? '/capabilities';
  const page = (
    <CapabilityFormPage
      meta={meta}
      actionUrl={actionUrl}
      listUrl={listUrl}
      devSessionUrl={options.devSessionUrl}
      fields={fields}
    />
  );
  return `<!DOCTYPE html>\n${page.toString()}`;
};
