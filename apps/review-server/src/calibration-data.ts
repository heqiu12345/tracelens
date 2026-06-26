import type { DataSource, ScaleType, ScoreRecord } from '../../../packages/core/src/index.ts';
import { pairScores, type PairingMapping } from '../../../packages/adapter-langfuse/src/pairing.ts';
import { computeCalibration } from '../../../packages/adapter-langfuse/src/calibration.ts';

const PER_DIM_LIMIT = 2000;
const DRILL_LIMIT = 500;

export interface DimSpec { dimension: string; scale: ScaleType; }
export interface CalOpts { mapping?: PairingMapping; tolerance?: number; minSamples?: number; limit?: number; }

/** Fetch all scores for the relevant dimensions (human + judge), across traces. limit is the per-dimension cap (a safety bound).
 *  truncated: if any dimension hits the cap and the backend's real total exceeds it, mark the result as truncated (honest denominator). */
async function fetchScores(source: DataSource, dims: DimSpec[], opts: CalOpts): Promise<{ scores: ScoreRecord[]; truncated: boolean }> {
  if (!source.listScores) throw new Error('Data source does not support listScores; cannot aggregate calibration');
  const limit = opts.limit ?? PER_DIM_LIMIT;
  const names = new Set(dims.map((d) => d.dimension));
  // If the judge side uses a mapping (e.g. test_eva), include the mapped source names in the fetch too
  for (const [judgeName] of Object.entries(opts.mapping ?? {})) names.add(judgeName);
  const all: ScoreRecord[] = [];
  let truncated = false;
  for (const name of names) {
    const page = await source.listScores({ name }, { page: 1, limit });
    all.push(...page.items);
    if (page.items.length >= limit && (page.total ?? 0) > limit) truncated = true;
  }
  return { scores: all, truncated };
}

/** B Aggregate the calibration dashboard data. */
export async function computeDashboard(source: DataSource, dims: DimSpec[], opts: CalOpts) {
  const { scores, truncated } = await fetchScores(source, dims, opts);
  const pairing = pairScores(scores, { mapping: opts.mapping });
  const result = computeCalibration(pairing.pairs, dims, { tolerance: opts.tolerance, minSamples: opts.minSamples });
  return { ...result, pairedTraces: pairing.pairedTraces, totalTraces: pairing.totalTraces, truncated };
}

/** A Single-trace comparison data (just this trace's pairings + each side's reasoning). */
export async function computeDrilldown(source: DataSource, traceId: string, dims: DimSpec[], opts: CalOpts = {}) {
  if (!source.listScores) throw new Error('Data source does not support listScores');
  const scaleOf = new Map(dims.map((d) => [d.dimension, d.scale]));
  const page = await source.listScores({ traceId }, { page: 1, limit: DRILL_LIMIT });
  const pairing = pairScores(page.items, { mapping: opts.mapping });
  const pairs = pairing.pairs.map((p) => ({
    dimension: p.dimension,
    scale: scaleOf.get(p.dimension) ?? 'categorical',
    human: { value: p.human.value, comment: p.human.comment },
    judge: { value: p.judge.value, comment: p.judge.comment },
    agree: String(p.human.value) === String(p.judge.value),
  }));
  return { traceId, pairs };
}
