import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TamaguiProvider, YStack, XStack, Text } from 'tamagui';
import config from './tamagui.config.js';
import type { StoredApprovalRequest } from '../core/approval-store.js';

const APPROVAL_CSS = `.approval-table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.approval-table th{background:#1a1a2e;color:#fff;padding:8px 12px;text-align:left;font-size:12px}
.approval-table td{padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top}
.approval-actions{display:flex;gap:8px;flex-wrap:wrap}
.approval-actions form{display:inline}
.approval-actions button{cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #ccc;font-size:12px}
.approve-btn{background:#1a7f37;color:#fff;border-color:#1a7f37}
.reject-btn{background:#fff;color:#cc0000}
.approval-pre{margin:0;white-space:pre-wrap;font-size:11px;max-width:320px}`;

interface ApprovalPageProps {
  readonly title: string;
  readonly pending: readonly StoredApprovalRequest[];
}

const PendingRow = ({ item }: { item: StoredApprovalRequest }): React.ReactElement => (
  <tr>
    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.id.slice(0, 8)}</td>
    <td>{item.capabilityName}</td>
    <td>{item.userId}</td>
    <td>{item.riskLevel}</td>
    <td>
      <pre className="approval-pre">{JSON.stringify(item.input, null, 2)}</pre>
    </td>
    <td>
      <div className="approval-actions">
        <form method="post" action={`/approvals/${item.id}/approve`}>
          <input type="hidden" name="by" value="approval-console" />
          <button type="submit" className="approve-btn">
            Approve
          </button>
        </form>
        <form method="post" action={`/approvals/${item.id}/reject`}>
          <input type="hidden" name="by" value="approval-console" />
          <input type="hidden" name="reason" value="rejected from approval console" />
          <button type="submit" className="reject-btn">
            Reject
          </button>
        </form>
      </div>
    </td>
  </tr>
);

const ApprovalPageDocument = ({ title, pending }: ApprovalPageProps): React.ReactElement => (
  <html lang="en">
    <head>
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
      <style dangerouslySetInnerHTML={{ __html: APPROVAL_CSS }} />
    </head>
    <body style={{ margin: 0, minHeight: '100vh' }}>
      <TamaguiProvider config={config} defaultTheme="light">
        <YStack minHeight="100vh" backgroundColor="$background" padding="$3">
          <XStack
            paddingHorizontal="$3"
            paddingVertical="$2"
            backgroundColor="$headerBg"
            borderRadius="$2"
            marginBottom="$3"
          >
            <Text color="$headerColor" fontWeight="600" fontSize="$3">
              {title}
            </Text>
          </XStack>
          <Text color="$color" marginBottom="$2" fontSize="$2">
            {pending.length === 0
              ? 'No pending approvals.'
              : `${pending.length} pending approval${pending.length !== 1 ? 's' : ''}`}
          </Text>
          {pending.length > 0 ? (
            <table className="approval-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Capability</th>
                  <th>User</th>
                  <th>Risk</th>
                  <th>Input</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((item) => (
                  <PendingRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          ) : null}
        </YStack>
      </TamaguiProvider>
    </body>
  </html>
);

/**
 * 承認コンソール MVP の HTML を生成する。
 */
export const renderApprovalPageHtml = (
  pending: readonly StoredApprovalRequest[],
  options?: { title?: string },
): string => {
  const title = options?.title ?? 'Hikari Approvals';
  return (
    '<!DOCTYPE html>\n' +
    renderToStaticMarkup(<ApprovalPageDocument title={title} pending={pending} />)
  );
};
