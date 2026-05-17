import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TamaguiProvider, YStack, XStack, Text } from 'tamagui';
import config from '../web/tamagui.config.js';
import type { AuditEntry } from '../core/audit.js';
import type { TraceSpan, TraceStatus } from './trace-viewer.js';
import { partitionTraceEvents } from './trace-viewer.js';

const STATUS_COLOR: Record<TraceStatus, string> = {
  succeeded: '#22c55e',
  failed: '#ef4444',
  denied: '#f97316',
  pending: '#94a3b8',
};

const TRACE_TABLE_CSS = `*{box-sizing:border-box}
.trace-table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.trace-table th{background:#1a1a2e;color:#fff;padding:8px 12px;text-align:left;font-size:12px}
.trace-table td{padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top}
.trace-table tr:hover td{background:#f5f5ff}
.trace-meta{margin:0 0 12px;font-size:13px;color:#666}
.trace-nested{width:100%;border-collapse:collapse;font-size:12px}
.trace-nested th{background:#f0f0f0;text-align:left;padding:4px}
.trace-nested td{padding:4px;vertical-align:top}
.trace-pre{margin:0;white-space:pre-wrap;font-size:11px}`;

const EventRows = ({ events }: { events: readonly AuditEntry[] }): React.ReactElement => (
  <>
    {events.map((e, idx) => (
      <tr key={`${e.type}-${idx}`}>
        <td>{e.type}</td>
        <td>{e.timestamp.toISOString().slice(11, 23)}</td>
        <td>
          <pre className="trace-pre">
            {e.input !== undefined ? JSON.stringify(e.input, null, 2) : ''}
          </pre>
        </td>
        <td>
          <pre className="trace-pre">
            {e.output !== undefined ? JSON.stringify(e.output, null, 2).slice(0, 400) : ''}
          </pre>
        </td>
      </tr>
    ))}
  </>
);

const EventSection = ({
  title,
  events,
  accent,
}: {
  title: string;
  events: readonly AuditEntry[];
  accent: string;
}): React.ReactElement => {
  if (events.length === 0) return <></>;
  return (
    <>
      <tr>
        <td
          colSpan={4}
          style={{ padding: '8px 8px 4px', fontSize: 12, fontWeight: 600, color: accent }}
        >
          {`${title} (${events.length})`}
        </td>
      </tr>
      <tr>
        <td colSpan={4} style={{ padding: '0 8px 8px' }}>
          <table className="trace-nested">
            <thead>
              <tr>
                <th>Event</th>
                <th>Time</th>
                <th style={{ width: '35%' }}>Input</th>
                <th style={{ width: '35%' }}>Output</th>
              </tr>
            </thead>
            <tbody>
              <EventRows events={events} />
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
};

const SpanRow = ({ span }: { span: TraceSpan }): React.ReactElement => {
  const { harness, capability } = partitionTraceEvents(span.events);
  const hasHarness = harness.length > 0;
  const displayName =
    span.capabilityName === '_harness' && capability.length > 0
      ? capability[0]?.capabilityName ?? span.capabilityName
      : span.capabilityName;
  const color = STATUS_COLOR[span.status];
  const duration = span.durationMs !== undefined ? `${span.durationMs}ms` : '—';

  return (
    <>
      <tr>
        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{span.traceId.slice(0, 8)}</td>
        <td>
          {displayName}
          {hasHarness ? (
            <span
              style={{
                marginLeft: 6,
                fontSize: 10,
                color: '#6366f1',
                background: '#eef2ff',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              harness
            </span>
          ) : null}
        </td>
        <td>{span.userId}</td>
        <td>
          <span
            style={{
              background: color,
              color: '#fff',
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11,
            }}
          >
            {span.status}
          </span>
        </td>
        <td>{duration}</td>
        <td>{span.startedAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
      </tr>
      <tr>
        <td colSpan={6} style={{ padding: '0 8px 12px' }}>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12, marginBottom: 6 }}>
              {`Events (${span.events.length})`}
            </summary>
            <table className="trace-nested">
              <tbody>
                <EventSection
                  title="Harness (intent / plan / tool selection)"
                  events={harness}
                  accent="#4f46e5"
                />
                <EventSection
                  title="Capability execution"
                  events={capability}
                  accent="#0f766e"
                />
              </tbody>
            </table>
          </details>
        </td>
      </tr>
    </>
  );
};

interface TracePageProps {
  spans: TraceSpan[];
  title: string;
}

const TracePageDocument = ({ spans, title }: TracePageProps): React.ReactElement => (
  <html lang="en">
    <head>
      <meta charSet="UTF-8" />
      <title>{title}</title>
      <style dangerouslySetInnerHTML={{ __html: TRACE_TABLE_CSS }} />
    </head>
    <body style={{ margin: 0, minHeight: '100vh', fontFamily: 'system-ui,sans-serif' }}>
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
          <Text className="trace-meta" color="$color" marginBottom="$2">
            {`${spans.length} trace${spans.length !== 1 ? 's' : ''}`}
          </Text>
          <table className="trace-table">
            <thead>
              <tr>
                <th>Trace ID</th>
                <th>Capability</th>
                <th>User</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {spans.map((span) => (
                <SpanRow key={span.traceId} span={span} />
              ))}
            </tbody>
          </table>
        </YStack>
      </TamaguiProvider>
    </body>
  </html>
);

/**
 * Tamagui シェル付きトレース HTML を生成する。
 */
export const renderTracePageHtml = (spans: TraceSpan[], title: string): string =>
  '<!DOCTYPE html>\n' + renderToStaticMarkup(<TracePageDocument spans={spans} title={title} />);
