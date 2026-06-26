/**
 * @tracelens/adapter-langfuse — a DataSource implementation for Langfuse.
 *
 * Zero dependencies: talks directly to the Langfuse public REST API via Node's
 *   native fetch, so it isn't tied to any SDK version.
 * Easy to use: `langfuseDataSource({host,publicKey,secretKey})` or `langfuseDataSourceFromEnv()`.
 * Easy to extend: the filter translation (buildTraceQuery) can be overridden on its
 *   own; fetch / scoresPath / searchMetadataKey are all configurable.
 * Works out of the box: ships with `langfuseDefaultRenderer` so you still get a readable
 *   conversation even before writing a dedicated renderer.
 */
import type {
  DataSource, RawTrace, ScoreRecord, ScoreFilter, TraceFilter, PageReq, Page,
} from '../../core/src/index.ts';
import { buildTraceQuery } from './query.ts';

export interface LangfuseConfig {
  /** Langfuse host, e.g. https://cloud.langfuse.com or your self-hosted URL. */
  host: string;
  publicKey: string;
  secretKey: string;
  /** Custom fetch (testing / proxy / self-signed certs). Defaults to the global fetch (Node ≥ 18). */
  fetch?: typeof globalThis.fetch;
  /** The public API has no generic full-text search; if your query text lives under a metadata key, pass it to support filter.search. */
  searchMetadataKey?: string;
  /** scores endpoint; defaults to /api/public/v2/scores — older self-hosted instances can switch to /api/public/scores. */
  scoresPath?: string;
}

function toRawTrace(t: Record<string, any>): RawTrace {
  return {
    id: String(t.id),
    sessionId: t.sessionId ?? undefined,
    userId: t.userId ?? undefined,
    timestamp: t.timestamp ?? undefined,
    tags: Array.isArray(t.tags) ? t.tags : [],
    raw: t,
  };
}

function toScore(s: Record<string, any>): ScoreRecord {
  const src = String(s.source ?? '').toUpperCase();
  const source: ScoreRecord['source'] = src === 'ANNOTATION' ? 'human' : src === 'EVAL' ? 'eval' : 'user';
  return {
    name: String(s.name),
    value: s.value ?? s.stringValue ?? '',
    source,
    comment: s.comment ?? undefined,
    traceId: s.traceId ?? undefined,
    timestamp: s.timestamp ?? s.createdAt ?? undefined,
  };
}

export function langfuseDataSource(cfg: LangfuseConfig): DataSource {
  const doFetch = cfg.fetch ?? globalThis.fetch;
  if (!doFetch) throw new Error('No global fetch — upgrade to Node ≥ 18 or pass cfg.fetch.');
  const base = cfg.host.replace(/\/+$/, '');
  const auth = 'Basic ' + Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString('base64');
  const scoresPath = cfg.scoresPath ?? '/api/public/v2/scores';

  async function api(path: string, params?: URLSearchParams): Promise<any> {
    const qs = params && [...params.keys()].length ? `?${params}` : '';
    const res = await doFetch(base + path + qs, {
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Langfuse ${res.status} ${res.statusText} @ ${path}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }
    return res.json();
  }

  return {
    name: 'langfuse',

    async listTraces(filter: TraceFilter, page: PageReq): Promise<Page<RawTrace>> {
      if (filter.search && !cfg.searchMetadataKey) {
        console.warn('[tracelens:langfuse] filter.search ignored — Langfuse public API has no generic full-text search. Set config.searchMetadataKey to map it onto a metadata field.');
      }
      const body = await api('/api/public/traces', buildTraceQuery(filter, page, cfg.searchMetadataKey));
      const meta = body.meta ?? {};
      const data: any[] = body.data ?? [];
      return {
        items: data.map(toRawTrace),
        total: meta.totalItems ?? data.length,
        page: meta.page ?? page.page,
        limit: meta.limit ?? page.limit,
      };
    },

    async getTrace(id: string): Promise<RawTrace> {
      return toRawTrace(await api(`/api/public/traces/${encodeURIComponent(id)}`));
    },

    async getScores(traceId: string): Promise<ScoreRecord[]> {
      const body = await api(scoresPath, new URLSearchParams({ traceId }));
      const data: any[] = body.data ?? [];
      return data.map(toScore);
    },

    async listScores(filter: ScoreFilter, page: PageReq): Promise<Page<ScoreRecord>> {
      const items: ScoreRecord[] = [];
      const batch = Math.min(page.limit, 100); // per-request size (Langfuse caps a single page at ~100)
      let cur = page.page;
      let total = Infinity;
      // Paginate and accumulate until we hit the limit (a safety cap), reach the backend total, or get an empty page
      while (items.length < page.limit && items.length < total) {
        const p = new URLSearchParams({ page: String(cur), limit: String(batch) });
        if (filter.name) p.set('name', filter.name);
        if (filter.source) p.set('source', filter.source === 'human' ? 'ANNOTATION' : filter.source === 'eval' ? 'EVAL' : 'API');
        if (filter.traceId) p.set('traceId', filter.traceId);
        if (filter.from) p.set('fromTimestamp', filter.from);
        if (filter.to) p.set('toTimestamp', filter.to);
        const body = await api(scoresPath, p);
        const data: any[] = body.data ?? [];
        if (body.meta?.totalItems != null) total = body.meta.totalItems;
        if (!data.length) break;
        for (const s of data) { if (items.length < page.limit) items.push(toScore(s)); }
        cur += 1;
      }
      return { items, total: Number.isFinite(total) ? total : items.length, page: page.page, limit: page.limit };
    },
  };
}

/** Build from environment variables: LANGFUSE_HOST / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY. */
export function langfuseDataSourceFromEnv(extra?: Partial<LangfuseConfig>): DataSource {
  const env = (k: string): string | undefined => (typeof process !== 'undefined' ? process.env?.[k] : undefined);
  const host = extra?.host ?? env('LANGFUSE_HOST') ?? env('LANGFUSE_BASEURL');
  const publicKey = extra?.publicKey ?? env('LANGFUSE_PUBLIC_KEY');
  const secretKey = extra?.secretKey ?? env('LANGFUSE_SECRET_KEY');
  if (!host || !publicKey || !secretKey) {
    throw new Error('Missing Langfuse config: set LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY (or pass them in).');
  }
  return langfuseDataSource({ ...extra, host, publicKey, secretKey });
}

export { buildTraceQuery } from './query.ts';
export { langfuseDefaultRenderer } from './default-renderer.ts';
export { buildObservationTurns, extractToolCalls } from './observation-tree.ts';
export type { LangfuseObservation, ExtractedToolCall } from './observation-tree.ts';
export { extractText } from './extract.ts';
export { langfuseScoreSink } from './feedback-sink.ts';
export type { LangfuseScoreSinkConfig } from './feedback-sink.ts';
export type { LangfuseConfig as LangfuseAdapterConfig };
