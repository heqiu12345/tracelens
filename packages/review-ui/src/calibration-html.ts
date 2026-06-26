import { esc } from './html.ts';

/** Structured inputs (aligned with the shape sent by the server; does not import adapter types, keeping review-ui decoupled). */
export interface DashConfusion { rows: string[]; counts: Record<string, Record<string, number>>; }
export interface DashDimension {
  dimension: string; scale: string; n: number; lowConfidence: boolean; agreementRate: number;
  numeric?: { withinTol: number; pearson: number; humanMean: number; judgeMean: number; biasDelta: number };
  categorical?: { exactAgreement: number; kappa: number; matrix: DashConfusion };
}
export interface DashboardData {
  overall: { agreementRate: number; disagreements: number; severeDisagreements: number; biasNote?: string };
  pairedTraces: number; totalTraces: number;
  truncated?: boolean;
  dimensions: DashDimension[];
  topDisagreements: { traceId: string; dimension: string; humanValue: unknown; judgeValue: unknown; severe: boolean; magnitude: number }[];
}
export interface DrillPair { dimension: string; scale: string; human: { value: unknown; comment?: string }; judge: { value: unknown; comment?: string }; agree: boolean; }
export interface DrilldownData { pairs: DrillPair[]; }

const pct = (x: number): string => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');
const f2 = (x: unknown): string => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : '—');

/** Find the largest off-diagonal (disagreement) cell in the confusion matrix, for highlighting. */
function maxOffDiag(m: DashConfusion): { r: string; c: string } | undefined {
  let best: { r: string; c: string } | undefined; let max = 0;
  for (const r of m.rows) for (const c of m.rows) {
    if (r !== c && (m.counts[r]?.[c] ?? 0) > max) { max = m.counts[r]![c]!; best = { r, c }; }
  }
  return best;
}

function confusion(m: DashConfusion): string {
  const hot = maxOffDiag(m);
  const head = `<tr><th></th>${m.rows.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = m.rows.map((r) => `<tr><th>${esc(r)}</th>${m.rows.map((c) => {
    const v = m.counts[r]?.[c] ?? 0;
    const cls = r === c ? 'tl-cm-diag' : (hot && hot.r === r && hot.c === c ? 'tl-cm-hot' : '');
    return `<td class="${cls}">${v}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="tl-cal-cm"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function dimRow(d: DashDimension): string {
  const low = d.lowConfidence ? ' tl-cal-low' : '';
  const detail = d.scale === 'numeric' && d.numeric
    ? `within ±1 <b>${pct(d.numeric.withinTol)}</b> · r=${f2(d.numeric.pearson)} · mean human ${f2(d.numeric.humanMean)}/judge ${f2(d.numeric.judgeMean)}`
    : d.categorical
    ? `exact <b>${pct(d.categorical.exactAgreement)}</b> · κ=${f2(d.categorical.kappa)}`
    : '';
  const lowTag = d.lowConfidence ? `<span class="tl-cal-lowtag">Low sample · n=${d.n}</span>` : `<span class="tl-cal-n">n=${d.n}</span>`;
  const cm = d.categorical ? `<div class="tl-cal-cmwrap">${confusion(d.categorical.matrix)}</div>` : '';
  return `<div class="tl-cal-dim${low}">
    <div class="tl-cal-dim-h"><span class="tl-cal-dim-name">${esc(d.dimension)} <i>${esc(d.scale)}</i></span>${lowTag}</div>
    <div class="tl-cal-bar"><div class="tl-cal-bar-fill" style="width:${Math.round((Number.isFinite(d.agreementRate) ? d.agreementRate : 0) * 100)}%"></div></div>
    <div class="tl-cal-dim-detail">${detail}</div>${cm}</div>`;
}

function topRow(t: DashboardData['topDisagreements'][number]): string {
  const sev = t.severe ? ' tl-cal-sev' : '';
  return `<div class="tl-cal-top${sev}" data-trace="${esc(t.traceId)}" data-dim="${esc(t.dimension)}">
    <span class="tl-cal-top-id">${esc(t.traceId)}</span>
    <span class="tl-cal-top-dim">${esc(t.dimension)}</span>
    <span>human <b>${esc(String(t.humanValue))}</b></span>
    <span class="tl-cal-top-j">judge <b>${esc(String(t.judgeValue))}</b></span></div>`;
}

/** B: aggregate calibration dashboard. */
export function renderCalibrationDashboard(d: DashboardData): string {
  const o = d.overall;
  const overview = `<div class="tl-cal-ov">
    <div class="tl-cal-rate">${pct(o.agreementRate)}<span>Human–judge agreement</span></div>
    <div class="tl-cal-ov-meta">
      <div>Covering <b>${d.pairedTraces} / ${d.totalTraces}</b> traces (scored by both)</div>
      <div>${o.disagreements} disagreement${o.disagreements === 1 ? '' : 's'} · ${o.severeDisagreements} severe disagreement${o.severeDisagreements === 1 ? '' : 's'}</div>
      ${o.biasNote ? `<div>${esc(o.biasNote)}</div>` : ''}
    </div></div>`;
  const dims = d.dimensions.map(dimRow).join('');
  const tops = d.topDisagreements.length
    ? `<div class="tl-cal-sec">Top disagreements · click to drill in</div>${d.topDisagreements.map(topRow).join('')}`
    : '';
  const trunc = d.truncated
    ? `<div class="tl-cal-trunc">⚠ Sample exceeded the cap — the view below is based on a partial sample and may not represent the full set.</div>`
    : '';
  return `<div class="tl-cal">${trunc}${overview}<div class="tl-cal-sec">Agreement by dimension</div>${dims}${tops}</div>`;
}

function drillCard(p: DrillPair): string {
  const cls = p.agree ? 'tl-cal-agree' : 'tl-cal-disagree';
  const tag = p.agree ? '<span class="tl-cal-badge ok">Agree</span>' : '<span class="tl-cal-badge no">Disagree</span>';
  const side = (label: string, v: unknown, comment?: string): string =>
    `<div class="tl-cal-side"><div class="tl-cal-side-h">${label}</div><div class="tl-cal-side-v">${esc(String(v))}</div>${comment ? `<div class="tl-cal-side-c">${esc(comment)}</div>` : ''}</div>`;
  return `<div class="tl-cal-card ${cls}">
    <div class="tl-cal-card-h">${esc(p.dimension)} <i>${esc(p.scale)}</i>${tag}</div>
    <div class="tl-cal-cols">${side('👤 Human', p.human.value, p.human.comment)}${side('🤖 LLM judge', p.judge.value, p.judge.comment)}</div></div>`;
}

/** A: single-trace comparison (per-dimension cards). */
export function renderCalibrationDrilldown(d: DrilldownData): string {
  if (!d.pairs.length) return '<div class="muted">This trace has no pairable “human + judge” scores.</div>';
  return `<div class="tl-cal-drill">${d.pairs.map(drillCard).join('')}</div>`;
}

/** Calibration view styles. */
export const CALIBRATION_CSS = `
.tl-cal{display:flex;flex-direction:column;gap:10px}
.tl-cal-sec{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5b6472;font-weight:600;margin-top:10px}
.tl-cal-ov{display:flex;gap:24px;align-items:center;background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px 18px}
.tl-cal-rate{font-size:34px;font-weight:800;color:var(--accent);display:flex;flex-direction:column;line-height:1}
.tl-cal-rate span{font-size:12px;font-weight:500;color:#5b6472;margin-top:4px}
.tl-cal-ov-meta{font-size:12.5px;color:#5b6472;display:flex;flex-direction:column;gap:3px}
.tl-cal-dim{background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.tl-cal-dim.tl-cal-low{opacity:.55}
.tl-cal-dim-h{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600}
.tl-cal-dim-name i{font-weight:400;color:#94a3b8;font-size:11px}
.tl-cal-n{font-size:11px;color:#94a3b8}
.tl-cal-lowtag{font-size:11px;color:#b45309;background:#fef3c7;border-radius:6px;padding:1px 7px}
.tl-cal-bar{height:8px;background:#eef1f5;border-radius:5px;margin:7px 0 4px;overflow:hidden}
.tl-cal-bar-fill{height:100%;background:var(--accent);border-radius:5px}
.tl-cal-dim-detail{font-size:12px;color:#5b6472}
.tl-cal-cmwrap{margin-top:8px}
.tl-cal-cm{border-collapse:collapse;font-size:11.5px}
.tl-cal-cm th,.tl-cal-cm td{border:1px solid var(--border);padding:3px 9px;text-align:center;color:#475569}
.tl-cal-cm td.tl-cm-diag{background:#eef5ff;font-weight:700}
.tl-cal-cm td.tl-cm-hot{background:#fef3c7;font-weight:700;color:#b45309}
.tl-cal-top{display:grid;grid-template-columns:1fr 130px 70px 90px;gap:8px;align-items:center;font-size:12px;font-family:var(--mono);padding:6px 9px;border-radius:7px;cursor:pointer;background:#fff;border:1px solid var(--border)}
.tl-cal-top:hover{background:#eef4ff}
.tl-cal-top.tl-cal-sev{border-color:#fde9b8}
.tl-cal-top-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tl-cal-top-dim{color:#5b6472}
.tl-cal-top-j{color:#c0392b}
.tl-cal-drill{display:flex;flex-direction:column;gap:10px}
.tl-cal-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.tl-cal-card.tl-cal-disagree{border-left:4px solid #d97706}
.tl-cal-card.tl-cal-agree{border-left:4px solid #16a34a;background:#fbfdfb}
.tl-cal-card-h{font-weight:700;font-size:13px;display:flex;gap:8px;align-items:center;margin-bottom:8px}
.tl-cal-card-h i{font-weight:400;color:#94a3b8;font-size:11px}
.tl-cal-badge{font-size:11px;font-weight:700;padding:1px 8px;border-radius:7px;margin-left:auto}
.tl-cal-badge.ok{background:#e6f7f1;color:#0a7f5b}.tl-cal-badge.no{background:#fef3c7;color:#b45309}
.tl-cal-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tl-cal-side{border-radius:9px;padding:9px 11px}
.tl-cal-card .tl-cal-side:first-child{background:#eff5ff}
.tl-cal-card .tl-cal-side:last-child{background:#f8f5ff}
.tl-cal-side-h{font-size:11px;color:#5b6472;margin-bottom:3px}
.tl-cal-side-v{font-size:20px;font-weight:800;color:#1f2733}
.tl-cal-side-c{font-size:12px;color:#475569;margin-top:4px}
.tl-cal-trunc{font-size:11.5px;color:#b45309;background:#fef3c7;border:1px solid #fde9b8;border-radius:7px;padding:6px 10px}
`;
