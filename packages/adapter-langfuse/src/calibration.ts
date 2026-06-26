import type { PairedScore } from './pairing.ts';
import type { ScaleType } from '../../core/src/index.ts';

const num = (v: unknown): number => Number(v);
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }

/** Pearson correlation; returns NaN when variance is 0 or the sample is too small. */
export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = mean(xs), my = mean(ys);
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i]! - mx, b = ys[i]! - my; cov += a * b; vx += a * a; vy += b * b; }
  const den = Math.sqrt(vx * vy);
  return den === 0 ? NaN : cov / den;
}

export interface NumericMetrics {
  n: number; withinTol: number; pearson: number; humanMean: number; judgeMean: number; biasDelta: number;
}

/** Numeric dimension metrics: agreement rate within ±tol + correlation + means + bias (judge − human, positive = lenient). */
export function numericDimMetrics(pairs: PairedScore[], tolerance = 1): NumericMetrics {
  const hs = pairs.map((p) => num(p.human.value));
  const js = pairs.map((p) => num(p.judge.value));
  const n = pairs.length;
  const within = pairs.filter((_, i) => Math.abs(hs[i]! - js[i]!) <= tolerance).length;
  const humanMean = mean(hs), judgeMean = mean(js);
  return { n, withinTol: n ? within / n : NaN, pearson: pearson(hs, js), humanMean, judgeMean, biasDelta: judgeMean - humanMean };
}

const cat = (v: unknown): string => String(v);

export interface ConfusionMatrix {
  /** Categories (rows = human and columns = judge share the same set). */
  rows: string[];
  /** counts[human][judge] = the count. */
  counts: Record<string, Record<string, number>>;
}
export interface CategoricalMetrics { n: number; exactAgreement: number; kappa: number; matrix: ConfusionMatrix; }

/** Cohen's κ: agreement corrected for chance. Perfect agreement → 1; no better than chance → ≤ 0. */
export function cohensKappa(hs: string[], js: string[]): number {
  const n = hs.length;
  if (n === 0) return NaN;
  const cats = [...new Set([...hs, ...js])];
  const hCount: Record<string, number> = {}, jCount: Record<string, number> = {};
  let agree = 0;
  for (let i = 0; i < n; i++) {
    if (hs[i] === js[i]) agree++;
    hCount[hs[i]!] = (hCount[hs[i]!] ?? 0) + 1;
    jCount[js[i]!] = (jCount[js[i]!] ?? 0) + 1;
  }
  const po = agree / n;
  let pe = 0;
  for (const c of cats) pe += ((hCount[c] ?? 0) / n) * ((jCount[c] ?? 0) / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/** Categorical/binary dimension metrics: exact agreement rate + κ + confusion matrix. */
export function categoricalDimMetrics(pairs: PairedScore[]): CategoricalMetrics {
  const hs = pairs.map((p) => cat(p.human.value));
  const js = pairs.map((p) => cat(p.judge.value));
  const n = pairs.length;
  const exact = pairs.filter((_, i) => hs[i] === js[i]).length;
  const rows = [...new Set([...hs, ...js])].sort();
  const counts: Record<string, Record<string, number>> = {};
  for (const r of rows) { counts[r] = {}; for (const c of rows) counts[r]![c] = 0; }
  for (let i = 0; i < n; i++) counts[hs[i]!]![js[i]!]! += 1;
  return { n, exactAgreement: n ? exact / n : NaN, kappa: cohensKappa(hs, js), matrix: { rows, counts } };
}

export interface DimensionMetrics {
  dimension: string;
  scale: ScaleType;
  n: number;
  lowConfidence: boolean;
  agreementRate: number;
  numeric?: NumericMetrics;
  categorical?: CategoricalMetrics;
}
export interface Disagreement { traceId: string; dimension: string; humanValue: unknown; judgeValue: unknown; severe: boolean; magnitude: number; }
export interface CalibrationResult {
  overall: { agreementRate: number; disagreements: number; severeDisagreements: number; biasNote?: string };
  dimensions: DimensionMetrics[];
  topDisagreements: Disagreement[];
}

function divergence(scale: ScaleType, h: unknown, j: unknown): number {
  if (scale === 'numeric') return Math.abs(Number(h) - Number(j));
  return String(h) === String(j) ? 0 : 1;
}
function isSevere(scale: ScaleType, h: unknown, j: unknown): boolean {
  return scale === 'numeric' ? Math.abs(Number(h) - Number(j)) >= 2 : String(h) !== String(j);
}

/** Aggregate calibration: compute per-dimension metrics (with confidence gating), count disagreements / severe disagreements, and rank the top disagreements. */
export function computeCalibration(
  pairs: PairedScore[],
  dims: { dimension: string; scale: ScaleType }[],
  opts: { tolerance?: number; minSamples?: number } = {},
): CalibrationResult {
  const tolerance = opts.tolerance ?? 1;
  const minSamples = opts.minSamples ?? 20;
  const dimensions: DimensionMetrics[] = [];
  const disagreements: Disagreement[] = [];

  for (const { dimension, scale } of dims) {
    const dp = pairs.filter((p) => p.dimension === dimension);
    if (!dp.length) continue;
    let agreementRate: number, dm: DimensionMetrics;
    if (scale === 'numeric') {
      const m = numericDimMetrics(dp, tolerance);
      agreementRate = m.withinTol;
      dm = { dimension, scale, n: m.n, lowConfidence: m.n < minSamples, agreementRate, numeric: m };
    } else {
      const m = categoricalDimMetrics(dp);
      agreementRate = m.exactAgreement;
      dm = { dimension, scale, n: m.n, lowConfidence: m.n < minSamples, agreementRate, categorical: m };
    }
    dimensions.push(dm);
    for (const p of dp) {
      const mag = divergence(scale, p.human.value, p.judge.value);
      if (mag > 0) disagreements.push({ traceId: p.traceId, dimension, humanValue: p.human.value, judgeValue: p.judge.value, severe: isSevere(scale, p.human.value, p.judge.value), magnitude: mag });
    }
  }

  const total = dimensions.reduce((a, d) => a + d.n, 0);
  const agreed = dimensions.reduce((a, d) => a + d.agreementRate * d.n, 0);
  const severe = disagreements.filter((d) => d.severe).length;
  const numericBias = dimensions.find((d) => d.numeric)?.numeric?.biasDelta;
  const biasNote = numericBias === undefined ? undefined
    : numericBias > 0.1 ? `judge is lenient +${numericBias.toFixed(2)}`
    : numericBias < -0.1 ? `judge is strict ${numericBias.toFixed(2)}` : 'judge ~ human (on par)';

  return {
    overall: { agreementRate: total ? agreed / total : NaN, disagreements: disagreements.length, severeDisagreements: severe, biasNote },
    dimensions,
    topDisagreements: disagreements.sort((a, b) => b.magnitude - a.magnitude).slice(0, 50),
  };
}
