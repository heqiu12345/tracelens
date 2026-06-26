/**
 * App config: with LANGFUSE_* env vars it connects to a real Langfuse (live);
 * otherwise it uses the built-in mock data (demo).
 * This lets the app run out of the box (demo) and switch to live data by setting
 * 3 env vars — easy to adopt.
 */
import type { DataSource, Renderer, Rubric, FeedbackSink } from '../../../packages/core/src/index.ts';
import {
  langfuseDataSource, langfuseDefaultRenderer, langfuseScoreSink,
} from '../../../packages/adapter-langfuse/src/index.ts';
import { mockDataSource } from './mock.ts';

export interface AppConfig {
  source: DataSource;
  renderer: Renderer;
  rubric: Rubric;
  sink: FeedbackSink;
  mode: 'live' | 'demo';
  sourceName: string;
  /**
   * Who performs the search:
   *   'server' — the data source can truly search on the backend (mock full-text / a Langfuse with searchMetadataKey configured).
   *   'client' — the backend has no full-text search (Langfuse with no key configured); the frontend falls back to substring-filtering the current window of results.
   */
  searchMode: 'server' | 'client';
  /** When set, the frontend shows a search-capability hint. */
  searchHint?: string;
  /** Calibration: rubric dimension → score name + scale (score names follow the rubricId.key convention). */
  calDims: { dimension: string; scale: 'binary' | 'numeric' | 'categorical' }[];
  /** Explicit mapping for when judge score names don't line up with human dimensions (e.g. { test_eva: 'default.accuracy' }); can be injected via the LANGFUSE_JUDGE_MAP env var. */
  calMapping?: Record<string, string>;
}

const RUBRIC: Rubric = {
  id: 'default',
  version: 'v1',
  dimensions: [
    { key: 'helpfulness', label: 'Helpfulness', description: 'Did it address the request?', scale: 'numeric', range: [1, 5] },
    { key: 'accuracy', label: 'Factual accuracy', scale: 'binary' },
    { key: 'tone', label: 'Tone', scale: 'categorical', options: ['great', 'ok', 'off'] },
  ],
};

function calDimsOf(r: Rubric): AppConfig['calDims'] {
  return r.dimensions.map((d) => ({ dimension: `${r.id}.${d.key}`, scale: d.scale }));
}
function parseJudgeMap(s?: string): Record<string, string> | undefined {
  if (!s) return undefined;
  try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : undefined; } catch { return undefined; }
}

function consoleSink(): FeedbackSink {
  return {
    name: 'console',
    kind: 'calibration',
    async submit(j) { console.log('[tracelens] judgment:', JSON.stringify(j)); },
  };
}

export function loadConfig(): AppConfig {
  const env = (k: string): string | undefined => (typeof process !== 'undefined' ? process.env?.[k] : undefined);
  const host = env('LANGFUSE_HOST');
  const publicKey = env('LANGFUSE_PUBLIC_KEY');
  const secretKey = env('LANGFUSE_SECRET_KEY');
  if (host && publicKey && secretKey) {
    const searchKey = env('LANGFUSE_SEARCH_METADATA_KEY');
    return {
      source: langfuseDataSource({ host, publicKey, secretKey, searchMetadataKey: searchKey }),
      renderer: langfuseDefaultRenderer,
      rubric: RUBRIC,
      sink: langfuseScoreSink({ host, publicKey, secretKey }),
      mode: 'live',
      sourceName: `Langfuse @ ${host}`,
      searchMode: searchKey ? 'server' : 'client',
      searchHint: searchKey
        ? undefined
        : 'Langfuse has no full-text API — filtering this page by id / session / userId / tags. For server-side full-text search set LANGFUSE_SEARCH_METADATA_KEY, or narrow with the userId / tags filters above.',
      calDims: calDimsOf(RUBRIC),
      calMapping: parseJudgeMap(env('LANGFUSE_JUDGE_MAP')),
    };
  }
  return {
    source: mockDataSource(),
    renderer: langfuseDefaultRenderer,
    rubric: RUBRIC,
    sink: consoleSink(),
    mode: 'demo',
    sourceName: 'in-memory demo data',
    searchMode: 'server',
    calDims: calDimsOf(RUBRIC),
  };
}
