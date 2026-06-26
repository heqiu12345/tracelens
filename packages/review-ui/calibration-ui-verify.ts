/**
 * Calibration rendering self-check: renderCalibrationDashboard / renderCalibrationDrilldown + XSS.
 * Run: node packages/review-ui/calibration-ui-verify.ts
 */
import { renderCalibrationDashboard, renderCalibrationDrilldown } from './src/calibration-html.ts';

let fail = 0;
function ok(c: boolean, n: string): void { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) fail++; }
function has(h: string, s: string, n: string): void { ok(h.includes(s), `${n} ⊇ ${JSON.stringify(s)}`); }

const dash = {
  overall: { agreementRate: 0.72, disagreements: 3, severeDisagreements: 2, biasNote: 'judge is lenient +0.40' },
  pairedTraces: 30, totalTraces: 100,
  dimensions: [
    { dimension: 'default.helpfulness', scale: 'numeric', n: 40, lowConfidence: false, agreementRate: 0.78, numeric: { n: 40, withinTol: 0.78, pearson: 0.62, humanMean: 3.8, judgeMean: 4.2, biasDelta: 0.4 } },
    { dimension: 'default.tone', scale: 'categorical', n: 8, lowConfidence: true, agreementRate: 0.64, categorical: { n: 8, exactAgreement: 0.64, kappa: 0.38, matrix: { rows: ['great', 'ok', 'off'], counts: { great: { great: 3, ok: 0, off: 0 }, ok: { great: 2, ok: 1, off: 0 }, off: { great: 0, ok: 0, off: 2 } } } } },
  ],
  topDisagreements: [
    { traceId: 't<1>', dimension: 'default.helpfulness', humanValue: 2, judgeValue: 5, severe: true, magnitude: 3 },
  ],
};
const hd = renderCalibrationDashboard(dash);
has(hd, '72%', 'dashboard shows overall agreement rate');
has(hd, '30 / 100', 'dashboard shows honest denominator');
has(hd, 'judge is lenient', 'dashboard shows bias summary');
has(hd, 'default.helpfulness', 'dashboard lists dimensions');
has(hd, 'tl-cal-low', 'lowConfidence dimension grayed-out marker');
has(hd, 'Low sample', 'lowConfidence hint text');
has(hd, 'tl-cal-cm', 'renders confusion matrix');
ok(hd.includes('data-trace="t&lt;1&gt;"') && !hd.includes('data-trace="t<1>"'), 'top disagreement row carries escaped trace id (XSS)');
has(hd, 'data-dim="default.helpfulness"', 'top disagreement row carries dimension');

const drill = {
  pairs: [
    { dimension: 'default.helpfulness', scale: 'numeric', human: { value: 2, comment: 'did not answer the question' }, judge: { value: 5, comment: '<b>structured</b>' }, agree: false },
    { dimension: 'default.accuracy', scale: 'binary', human: { value: true }, judge: { value: true }, agree: true },
  ],
};
const hr = renderCalibrationDrilldown(drill);
has(hr, 'did not answer the question', 'drilldown shows human comment');
ok(hr.includes('&lt;b&gt;structured&lt;/b&gt;') && !hr.includes('<b>structured</b>'), 'drilldown escapes judge comment (XSS)');
has(hr, 'tl-cal-disagree', 'disagreement card highlighted');
has(hr, 'tl-cal-agree', 'agreement card de-emphasized');

const ht = renderCalibrationDashboard({ ...dash, truncated: true });
has(ht, 'tl-cal-trunc', 'shows truncation note when truncated');
ok(!renderCalibrationDashboard({ ...dash, truncated: false }).includes('tl-cal-trunc'), 'no note when not truncated');

console.log(fail ? `\n❌ ${fail} FAILED` : '\n✅ calibration rendering self-check passed');
process.exit(fail ? 1 : 0);
