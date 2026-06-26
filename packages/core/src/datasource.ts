/**
 * DataSource — the fetch / write-back abstraction for traces.
 *
 * The standard filter primitives (TraceFilter) are translated by each adapter into a backend
 * query (e.g. the Langfuse filter DSL). The framework only understands this generic filter;
 * "the data source is swappable" is achieved by implementing different adapters, not by building
 * our own generic query layer (which would compete head-on with Langfuse and lose). First adapter:
 * Langfuse.
 */

/** A raw trace: the renderer consumes `raw` (the backend's native structure); the rest are generic index fields. */
export interface RawTrace {
  id: string;
  sessionId?: string;
  userId?: string;
  timestamp?: string;
  tags?: string[];
  /** The backend's native trace object (ADK event / OTel span / …), handed to the renderer to parse. */
  raw: unknown;
}

/** Generic filter primitives. Each adapter translates these into a concrete backend query. */
export interface TraceFilter {
  from?: string;
  to?: string;
  /** Matches any one of the tags. */
  tags?: string[];
  userId?: string;
  sessionId?: string;
  /** Exact equality on top-level metadata. */
  metadata?: Record<string, string>;
  /** Text contains (input/output). */
  search?: string;
}

export interface PageReq {
  page: number;
  limit: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** An existing score (drives the human-vs-judge comparison view). */
export interface ScoreRecord {
  name: string;
  value: number | string | boolean;
  /** Source: human annotation / automated evaluator / implicit user signal. */
  source?: 'human' | 'eval' | 'user';
  comment?: string;
  /** Backfilled when fetching scores across traces, to identify which trace this score belongs to. */
  traceId?: string;
  /** ISO time; used to pick the latest when a single (trace, dimension) has multiple scores. */
  timestamp?: string;
  /** Rubric version (backfilled when available from the backend; may be empty in the MVP). */
  rubricVersion?: string;
}

/** Filter primitives for fetching scores across traces; the adapter translates these into a backend query. */
export interface ScoreFilter {
  /** Filter by score name (dimension). */
  name?: string;
  /** Filter by source. */
  source?: 'human' | 'eval' | 'user';
  /** Limit to a single trace. */
  traceId?: string;
  from?: string;
  to?: string;
}

export interface DataSource {
  name: string;
  listTraces(filter: TraceFilter, page: PageReq): Promise<Page<RawTrace>>;
  getTrace(id: string): Promise<RawTrace>;
  /** Read existing scores (drives the human-vs-judge comparison view). Optional: leave unimplemented if the backend does not support it. */
  getScores?(traceId: string): Promise<ScoreRecord[]>;
  /** Fetch scores across traces (drives calibration aggregation). Optional: leave unimplemented if the backend does not support it. */
  listScores?(filter: ScoreFilter, page: PageReq): Promise<Page<ScoreRecord>>;
}
