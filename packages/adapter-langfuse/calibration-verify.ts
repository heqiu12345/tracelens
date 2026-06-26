/**
 * Calibration engine self-check (pure functions, offline): pairing + metrics.
 * Run: node packages/adapter-langfuse/calibration-verify.ts
 */
import type { ScoreRecord } from '../core/src/index.ts';
import { pairScores } from './src/pairing.ts';
import { numericDimMetrics, categoricalDimMetrics, computeCalibration } from './src/calibration.ts';

let fail = 0;
function ok(cond: boolean, name: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail++;
}

// ── pairing: same name + source ──
const base: ScoreRecord[] = [
  { name: 'default.helpfulness', value: 4, source: 'user', traceId: 't1' },
  { name: 'default.helpfulness', value: 5, source: 'eval', traceId: 't1' },
  { name: 'default.accuracy', value: 1, source: 'human', traceId: 't2' }, // human only, one-sided
];
const r1 = pairScores(base);
ok(r1.pairs.length === 1, 'same name + source forms one pair');
ok(r1.pairs[0]?.dimension === 'default.helpfulness' && Number(r1.pairs[0]?.human.value) === 4 && Number(r1.pairs[0]?.judge.value) === 5, 'pairing direction is correct (human/judge)');
ok(r1.pairedTraces === 1 && r1.totalTraces === 2, 'honest denominator: paired=1 / total=2 (t2 is one-sided and excluded)');

// ── explicit mapping ──
const mapped: ScoreRecord[] = [
  { name: 'default.accuracy', value: 1, source: 'human', traceId: 't3' },
  { name: 'test_eva', value: 0, source: 'eval', traceId: 't3' },
];
const r2 = pairScores(mapped, { mapping: { test_eva: 'default.accuracy' } });
ok(r2.pairs.length === 1 && r2.pairs[0]?.dimension === 'default.accuracy', 'mapping: test_eva → default.accuracy pairs up');

// ── same source, multiple scores: keep latest ──
const dup: ScoreRecord[] = [
  { name: 'default.tone', value: 'ok', source: 'user', traceId: 't4', timestamp: '2026-06-24T10:00:00Z' },
  { name: 'default.tone', value: 'great', source: 'user', traceId: 't4', timestamp: '2026-06-24T12:00:00Z' },
  { name: 'default.tone', value: 'great', source: 'eval', traceId: 't4' },
];
const r3 = pairScores(dup);
ok(r3.pairs[0]?.human.value === 'great', 'same source, multiple scores: keep latest (the 12:00 "great")');

// ── numeric dimension metrics ──
const numPairs = [
  { traceId: 'a', dimension: 'h', human: { value: 2 }, judge: { value: 4 } },
  { traceId: 'b', dimension: 'h', human: { value: 4 }, judge: { value: 5 } },
  { traceId: 'c', dimension: 'h', human: { value: 3 }, judge: { value: 4 } },
];
const nm = numericDimMetrics(numPairs, 1);
ok(nm.n === 3, 'numeric: sample size 3');
ok(Math.abs(nm.withinTol - 2 / 3) < 1e-9, 'numeric: agreement rate within ±1 = 2/3');
ok(Math.abs(nm.humanMean - 3) < 1e-9 && Math.abs(nm.judgeMean - (13 / 3)) < 1e-9, 'numeric: means are correct');
ok(nm.biasDelta > 0, 'numeric: judge is lenient (biasDelta>0)');
ok(nm.pearson > 0.5, 'numeric: positive correlation');

// ── categorical dimension metrics (exact agreement + κ + confusion matrix) ──
const catPairs = [
  { traceId: '1', dimension: 't', human: { value: 'great' }, judge: { value: 'great' } },
  { traceId: '2', dimension: 't', human: { value: 'ok' }, judge: { value: 'great' } },
  { traceId: '3', dimension: 't', human: { value: 'off' }, judge: { value: 'off' } },
  { traceId: '4', dimension: 't', human: { value: 'ok' }, judge: { value: 'ok' } },
];
const cm = categoricalDimMetrics(catPairs);
ok(cm.n === 4 && Math.abs(cm.exactAgreement - 0.75) < 1e-9, 'categorical: exact agreement rate = 3/4');
ok(cm.kappa > 0 && cm.kappa < 1, 'categorical: κ in (0,1)');
ok(cm.matrix.rows.includes('ok') && cm.matrix.counts['ok']?.['great'] === 1, 'categorical: confusion matrix human ok→judge great = 1');
const allAgree = [
  { traceId: '1', dimension: 'a', human: { value: true }, judge: { value: true } },
  { traceId: '2', dimension: 'a', human: { value: false }, judge: { value: false } },
];
ok(Math.abs(categoricalDimMetrics(allAgree).kappa - 1) < 1e-9, 'binary: full agreement κ=1');

// ── aggregation + gating + severe disagreements + Top ──
const aggPairs = [
  { traceId: 'a', dimension: 'helpfulness', human: { value: 2 }, judge: { value: 5 } },
  { traceId: 'b', dimension: 'helpfulness', human: { value: 4 }, judge: { value: 4 } },
  { traceId: 'c', dimension: 'tone', human: { value: 'ok' }, judge: { value: 'great' } },
];
const dims = [
  { dimension: 'helpfulness', scale: 'numeric' as const },
  { dimension: 'tone', scale: 'categorical' as const },
];
const cal = computeCalibration(aggPairs, dims, { tolerance: 1, minSamples: 20 });
ok(cal.dimensions.length === 2, 'aggregation: two dimensions');
ok(cal.dimensions.every((d) => d.lowConfidence), 'gating: samples < 20 are all lowConfidence');
ok(cal.overall.severeDisagreements === 2, 'severe disagreement count = 2 (gap of 3 + a flip)');
ok(cal.topDisagreements[0]?.dimension === 'helpfulness', 'Top disagreement: the largest gap ranks first');
ok(typeof cal.overall.agreementRate === 'number', 'overview includes the agreement rate');

console.log(fail ? `\n❌ ${fail} FAILED` : '\n✅ calibration engine self-check passed (pairing + metrics)');
process.exit(fail ? 1 : 0);
