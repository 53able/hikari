import type { Registry } from '../core/registry.js';
import { buildRegistryMeta, listApprovalRequired, type CapabilityMeta } from '../core/cap-meta.js';
import { needsHumanApproval } from '../core/policy.js';

/** `createCapabilityExplorer` が返す読み取り専用ビュー。 */
export type CapabilityExplorer = {
  readonly listMeta: () => CapabilityMeta[];
  readonly formatText: () => string;
  readonly renderHtml: () => string;
  readonly approvalRequired: () => string[];
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * レジストリ内のケイパビリティを人間・エージェント向けに一覧する devtools。
 */
export const createCapabilityExplorer = (registry: Registry): CapabilityExplorer => {
  const listMeta = () => buildRegistryMeta(registry);

  const formatText = (): string => {
    const lines = listMeta().map((meta) => {
      const approval =
        meta.policy.requiresApproval || meta.policy.requiresApprovalWhen
          ? ' [approval]'
          : '';
      return `${meta.name}${approval} — ${meta.description}\n  effects: ${meta.policy.sideEffects.join(', ')}\n  permissions: ${meta.policy.requiredPermissions.join(', ') || '(none)'}`;
    });
    return ['# Capabilities', '', ...lines].join('\n');
  };

  const renderHtml = (): string => {
    const rows = listMeta()
      .map((meta) => {
        const cap = registry.get(meta.name);
        const staticApproval = cap ? needsHumanApproval(cap.policy) : false;
        return `<tr>
  <td><code>${escapeHtml(meta.name)}</code></td>
  <td>${escapeHtml(meta.description)}</td>
  <td>${escapeHtml(meta.policy.sideEffects.join(', '))}</td>
  <td>${escapeHtml(meta.policy.requiredPermissions.join(', ') || '—')}</td>
  <td>${staticApproval || meta.policy.requiresApprovalWhen ? 'yes' : 'no'}</td>
  <td>${escapeHtml(meta.policy.auditLevel)}</td>
  <td><a href="/capabilities/${escapeHtml(meta.name)}/form">form</a></td>
</tr>`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>Hikari Capability Explorer</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f1419; color: #e7ecf3; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #2a3441; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
    th { background: #1a2332; }
    code { color: #7dd3fc; }
  </style>
</head>
<body>
  <h1>Capability Explorer</h1>
  <p>${listMeta().length} capabilities registered</p>
  <table>
    <thead>
      <tr><th>Name</th><th>Description</th><th>Effects</th><th>Permissions</th><th>Approval</th><th>Audit</th><th>Form</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
  };

  return {
    listMeta,
    formatText,
    renderHtml,
    approvalRequired: () => listApprovalRequired(registry),
  };
};
