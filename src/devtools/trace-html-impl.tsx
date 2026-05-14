import { h, Fragment, HtmlNode } from '../jsx/index.js';
import type { TraceSpan, TraceStatus } from './trace-viewer.js';

const STATUS_COLOR: Record<TraceStatus, string> = {
  succeeded: '#22c55e',
  failed: '#ef4444',
  denied: '#f97316',
  pending: '#94a3b8',
};

const CSS = `*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#f9f9f9;color:#333}
h1{font-size:18px;margin-bottom:16px;color:#1a1a2e}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)}
th{background:#1a1a2e;color:#fff;padding:8px 12px;text-align:left;font-size:12px}
td{padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top}
tr:hover td{background:#f5f5ff}`;

const TOGGLE_SCRIPT = `function toggleDetail(id){
  var el=document.getElementById(id);
  if(el){el.style.display=el.style.display==='none'?'table-row':'none';}
}`;

interface SpanRowProps {
  span: TraceSpan;
}

function SpanRow({ span }: SpanRowProps): HtmlNode {
  const color = STATUS_COLOR[span.status];
  const duration = span.durationMs !== undefined ? `${span.durationMs}ms` : '—';
  const detailId = `d-${span.traceId.replace(/-/g, '')}`;

  return (
    <>
      <tr>
        <td style="font-family:monospace;font-size:12px">{span.traceId.slice(0, 8)}</td>
        <td>{span.capabilityName}</td>
        <td>{span.userId}</td>
        <td>
          <span style={`background:${color};color:#fff;padding:2px 8px;border-radius:999px;font-size:11px`}>
            {span.status}
          </span>
        </td>
        <td>{duration}</td>
        <td>{span.startedAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
        <td>
          <button
            onclick={`toggleDetail('${detailId}')`}
            style="cursor:pointer;padding:2px 6px;border:1px solid #ccc;border-radius:4px;background:#f9f9f9"
          >
            ▶
          </button>
        </td>
      </tr>
      <tr id={detailId} style="display:none">
        <td colspan="7" style="padding:0 8px 12px">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#f0f0f0">
                <th style="text-align:left;padding:4px">Event</th>
                <th style="text-align:left;padding:4px">Time</th>
                <th style="text-align:left;padding:4px;width:35%">Input</th>
                <th style="text-align:left;padding:4px;width:35%">Output</th>
              </tr>
            </thead>
            <tbody>
              {span.events.map((e) => (
                <tr>
                  <td>{e.type}</td>
                  <td>{e.timestamp.toISOString().slice(11, 23)}</td>
                  <td>
                    <pre style="margin:0;white-space:pre-wrap;font-size:11px">
                      {e.input !== undefined ? JSON.stringify(e.input, null, 2) : ''}
                    </pre>
                  </td>
                  <td>
                    <pre style="margin:0;white-space:pre-wrap;font-size:11px">
                      {e.output !== undefined ? JSON.stringify(e.output, null, 2).slice(0, 400) : ''}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}

interface TracePageProps {
  spans: TraceSpan[];
  title: string;
}

function TracePage({ spans, title }: TracePageProps): HtmlNode {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <h1>{title}</h1>
        <p style="margin-bottom:12px;font-size:13px;color:#666">
          {spans.length} trace{spans.length !== 1 ? 's' : ''}
        </p>
        <table>
          <thead>
            <tr>
              <th>Trace ID</th>
              <th>Capability</th>
              <th>User</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Started</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {spans.map((span) => <SpanRow span={span} />)}
          </tbody>
        </table>
        <script dangerouslySetInnerHTML={{ __html: TOGGLE_SCRIPT }} />
      </body>
    </html>
  );
}

/**
 * 複数の `TraceSpan` を静的 HTML ページとしてレンダリングする。
 *
 * @param spans - 表示するトレーススパンの配列。
 * @param options - ページタイトルなどの設定。
 */
export function renderTraceHtml(
  spans: TraceSpan[],
  options?: { title?: string },
): string {
  const title = options?.title ?? 'Hikari Trace Viewer';
  return '<!DOCTYPE html>\n' + TracePage({ spans, title }).value;
}
