import type { Registry } from '../core/registry.js';
import { buildCapabilityMeta } from '../core/cap-meta.js';
import { createCapabilityExplorer } from '../devtools/cap-explorer.js';
import { renderCapabilityDevSessionHtml } from './cap-dev-session-page.js';
import { renderCapabilityFormHtml } from './cap-form-page.js';

/** ケイパビリティ投影 UI の URL プレフィックス。 */
export type CapabilityUiPathOptions = {
  /** 一覧・フォーム GET のベースパス。デフォルト: `/capabilities`。 */
  readonly uiBasePath?: string;
  /** REST 実行 POST のベースパス。デフォルト: `/api`。 */
  readonly apiBasePath?: string;
  /** 開発用 Cookie セッション UI（`{uiBasePath}/dev-session`）。本番では無効にすること。 */
  readonly enableDevSession?: boolean;
};

const normalizeBasePath = (path: string): string => {
  const trimmed = path.replace(/\/$/, '');
  if (trimmed === '') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

/** 解決済みパス（末尾スラッシュなし）。 */
export type ResolvedCapabilityUiPaths = {
  readonly uiBasePath: string;
  readonly apiBasePath: string;
};

/**
 * `createCapabilityUiHandlers` が返す HTML ハンドラ。
 * Node `createChatServer` と Hono `mountHikariCapabilityUi` で共有する。
 */
export type CapabilityUiHandlers = {
  readonly paths: ResolvedCapabilityUiPaths;
  readonly devSessionPath: string | undefined;
  readonly listHtml: () => string;
  readonly formHtml: (name: string) => string | null;
  readonly devSessionHtml: () => string | null;
  readonly matchesListPath: (url: string) => boolean;
  readonly matchesFormPath: (url: string) => string | null;
  readonly matchesDevSessionPath: (url: string) => boolean;
};

const resolvePaths = (options: CapabilityUiPathOptions): ResolvedCapabilityUiPaths => ({
  uiBasePath: normalizeBasePath(options.uiBasePath ?? '/capabilities'),
  apiBasePath: normalizeBasePath(options.apiBasePath ?? '/api'),
});

/**
 * レジストリからケイパビリティ一覧・入力フォーム HTML を生成するハンドラ。
 */
export const createCapabilityUiHandlers = (
  registry: Registry,
  options: CapabilityUiPathOptions = {},
): CapabilityUiHandlers => {
  const paths = resolvePaths(options);
  const devSessionPath = options.enableDevSession
    ? `${paths.uiBasePath}/dev-session`
    : undefined;
  const explorer = createCapabilityExplorer(registry, paths);

  const listHtml = (): string => explorer.renderHtml();

  const devSessionHtml = (): string | null =>
    devSessionPath
      ? renderCapabilityDevSessionHtml({
          actionUrl: devSessionPath,
          listUrl: paths.uiBasePath,
        })
      : null;

  const formHtml = (name: string): string | null => {
    const cap = registry.get(name);
    if (!cap) return null;
    const meta = buildCapabilityMeta(cap);
    return renderCapabilityFormHtml(meta, {
      actionUrl: `${paths.apiBasePath}/capabilities/${encodeURIComponent(name)}`,
      listUrl: paths.uiBasePath,
      devSessionUrl: devSessionPath,
    });
  };

  const matchesListPath = (url: string): boolean => url === paths.uiBasePath;

  const matchesFormPath = (url: string): string | null => {
    const prefix = `${paths.uiBasePath}/`;
    const suffix = '/form';
    if (!url.startsWith(prefix) || !url.endsWith(suffix)) return null;
    const middle = url.slice(prefix.length, url.length - suffix.length);
    if (!middle || middle.includes('/')) return null;
    return decodeURIComponent(middle);
  };

  const matchesDevSessionPath = (url: string): boolean =>
    devSessionPath !== undefined && url === devSessionPath;

  return {
    paths,
    devSessionPath,
    listHtml,
    formHtml,
    devSessionHtml,
    matchesListPath,
    matchesFormPath,
    matchesDevSessionPath,
  };
};
