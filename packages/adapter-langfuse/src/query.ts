import type { TraceFilter, PageReq } from '../../core/src/index.ts';

/** One metadata condition in the Langfuse trace.list filter DSL (a form verified to push down on self-hosted instances). */
interface MetaCond {
  type: 'stringObject';
  column: 'metadata';
  key: string;
  operator: '=' | 'contains';
  value: string;
}

/**
 * TraceFilter → query params for `GET /api/public/traces`.
 *
 * First-class columns (userId / sessionId / tags / time) use native params; metadata
 * equality + text search go through the `filter` DSL (JSON). A pure function — testable
 * on its own and overridable by the caller (easy to extend).
 *
 * @param searchMetadataKey Optional — the Langfuse public API has no generic input/output
 *   full-text search. If your query text lives under a metadata key (a common pattern),
 *   pass it to map `filter.search` onto `metadata.<key> contains`.
 */
export function buildTraceQuery(
  filter: TraceFilter,
  page: PageReq,
  searchMetadataKey?: string,
): URLSearchParams {
  const p = new URLSearchParams();
  p.set('page', String(page.page));
  p.set('limit', String(page.limit));
  if (filter.userId) p.set('userId', filter.userId);
  if (filter.sessionId) p.set('sessionId', filter.sessionId);
  if (filter.from) p.set('fromTimestamp', filter.from);
  if (filter.to) p.set('toTimestamp', filter.to);
  for (const t of filter.tags ?? []) p.append('tags', t);

  const conds: MetaCond[] = [];
  for (const [key, value] of Object.entries(filter.metadata ?? {})) {
    conds.push({ type: 'stringObject', column: 'metadata', key, operator: '=', value });
  }
  if (filter.search && searchMetadataKey) {
    conds.push({ type: 'stringObject', column: 'metadata', key: searchMetadataKey, operator: 'contains', value: filter.search });
  }
  if (conds.length) p.set('filter', JSON.stringify(conds));
  return p;
}
