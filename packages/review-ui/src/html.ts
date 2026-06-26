/**
 * review-ui — renders ConversationView / Rubric into HTML (zero-dependency, pure functions).
 *
 * Only knows the UI primitives from @tracelens/core; contains no domain logic. The same
 * rendering can be reused by the demo static page, an embedded widget, or a future
 * interactive review console.
 */
import type {
  ConversationView, Turn, Block, TableCell, Badge, Rubric,
} from '../../core/src/index.ts';

const TONE: Record<string, string> = {
  positive: 'color:#0a7f5b;background:#e6f7f1',
  negative: 'color:#c0392b;background:#fdecea',
  attention: 'color:#b9770e;background:#fcf3df',
  info: 'color:#2563eb;background:#e8f0fe',
  neutral: 'color:#5b6472;background:#eef1f5',
};

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<string, string>)[c]!);
}

/** Lightweight markdown (zero-dependency): **bold**, `code`, line-leading `- ` lists, and line breaks. esc() first to prevent XSS. */
function md(src: string): string {
  const lines = esc(src).split('\n');
  const out: string[] = [];
  let inList = false;
  for (const ln of lines) {
    if (/^\s*-\s+/.test(ln)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inline(ln.replace(/^\s*-\s+/, '')) + '</li>');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (ln.trim()) out.push('<p>' + inline(ln) + '</p>');
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
function inline(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

function badge(b: Badge): string {
  return `<span class="tl-badge" style="${TONE[b.tone ?? 'neutral'] ?? TONE.neutral}">${esc(b.text)}</span>`;
}

function pre(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return `<pre class="tl-code"><code>${esc(s)}</code></pre>`;
}

function block(b: Block): string {
  switch (b.type) {
    case 'text': return `<div class="tl-text">${esc(b.text).replace(/\n/g, '<br>')}</div>`;
    case 'markdown': return `<div class="tl-md">${md(b.markdown)}</div>`;
    case 'code': return `<pre class="tl-code"><code>${esc(b.code)}</code></pre>`;
    case 'image': return `<img class="tl-img" src="${esc(b.url)}" alt="${esc(b.alt ?? '')}">`;
    case 'divider': return '<hr class="tl-hr">';
    case 'tags': return `<div class="tl-tags">${b.badges.map(badge).join(' ')}</div>`;
    case 'card': {
      const img = b.imageUrl ? `<img class="tl-card-img" src="${esc(b.imageUrl)}" alt="">` : '';
      const t = b.title ? `<div class="tl-card-title">${b.href ? `<a href="${esc(b.href)}" target="_blank" rel="noopener">${esc(b.title)}</a>` : esc(b.title)}</div>` : '';
      const sub = b.subtitle ? `<div class="tl-card-sub">${esc(b.subtitle)}</div>` : '';
      const body = b.body ? `<div class="tl-card-body">${esc(b.body).replace(/\n/g, '<br>')}</div>` : '';
      const badges = b.badges?.length ? `<div class="tl-tags">${b.badges.map(badge).join(' ')}</div>` : '';
      return `<div class="tl-card">${img}${t}${sub}${body}${badges}</div>`;
    }
    case 'toolCall': {
      const st = b.status ?? 'ok';
      const args = b.args !== undefined ? pre(b.args) : '';
      const res = b.result !== undefined ? `<div class="tl-tool-res">${pre(b.result)}</div>` : '';
      return `<div class="tl-tool"><div class="tl-tool-head">🔧 <b>${esc(b.name)}</b><span class="tl-tool-st">${esc(st)}</span></div>${args}${res}</div>`;
    }
    case 'table': {
      const head = `<tr><th>${esc(b.rowHeaderLabel ?? '')}</th>${b.columns.map((c) => `<th>${c.header.map(block).join('')}</th>`).join('')}</tr>`;
      const rows = b.rows.map((r) => `<tr><td class="tl-dim">${esc(r.label ?? '')}</td>${r.cells.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('');
      const cap = b.caption ? `<caption>${esc(b.caption)}</caption>` : '';
      return `<table class="tl-table">${cap}<thead>${head}</thead><tbody>${rows}</tbody></table>`;
    }
  }
  return '';
}

function cell(c: TableCell): string {
  return c.blocks.map(block).join('');
}

/** Duration formatting: 340 → "340ms", 1500 → "1.5s". */
function fmtDur(ms: unknown): string | undefined {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return undefined;
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : `${Math.round(ms)}ms`;
}

/** Step header badges: observation type / model / duration / error level (only these conventional keys are rendered; domain keys are ignored). */
function metaBadges(meta?: Record<string, unknown>): string {
  if (!meta) return '';
  const out: string[] = [];
  if (typeof meta.obsType === 'string') out.push(`<span class="tl-mb tl-mb-type">${esc(meta.obsType)}</span>`);
  if (typeof meta.model === 'string') out.push(`<span class="tl-mb">${esc(meta.model)}</span>`);
  const d = fmtDur(meta.durationMs);
  if (d) out.push(`<span class="tl-mb">${esc(d)}</span>`);
  if (typeof meta.level === 'string') out.push(`<span class="tl-mb tl-mb-err">${esc(meta.level)}</span>`);
  return out.length ? `<span class="tl-mbs">${out.join('')}</span>` : '';
}

const ROLE_ICON: Record<string, string> = { user: '👤 User', assistant: '🤖 Assistant', system: '⚙ System', tool: '🔧 Tool' };

function headInner(t: Turn): string {
  const role = ROLE_ICON[t.role] ?? t.role;
  const label = t.label ? `<span class="tl-turn-agent">${esc(t.label)}</span>` : '';
  return `${role}${label}${metaBadges(t.meta)}`;
}

/** A turn / step: always expanded so its content is directly visible; indented by depth for process-tree nesting. */
function turn(t: Turn): string {
  const indent = t.depth ? ` style="margin-left:${Math.min(t.depth, 8) * 16}px"` : '';
  return `<div class="tl-turn tl-${t.role}"${indent}><div class="tl-turn-head">${headInner(t)}</div><div class="tl-turn-body">${t.blocks.map(block).join('')}</div></div>`;
}

export function renderConversationView(v: ConversationView): string {
  const title = v.title ? `<div class="tl-conv-title">${esc(v.title)}</div>` : '';
  const convo = v.turns.map(turn).join('');
  // Agent process tree (observations): a collapsible section, expanded by default; every step is rendered in full so no observation data is ever hidden.
  const n = v.steps?.length ?? 0;
  const steps = n
    ? `<details class="tl-steps" open><summary class="tl-steps-sum">🧭 Agent process · ${n} step${n > 1 ? 's' : ''}</summary><div class="tl-steps-body">${v.steps!.map(turn).join('')}</div></details>`
    : '';
  return `<div class="tl-conv">${title}${convo}${steps}</div>`;
}

export function renderScorePanel(r: Rubric): string {
  const dims = r.dimensions.map((d) => {
    let opts: string[];
    if (d.scale === 'binary') opts = ['👍 Good', '👎 Bad'];
    else if (d.scale === 'numeric') {
      const [min, max] = d.range ?? [1, 5];
      opts = [];
      for (let i = min; i <= max; i++) opts.push(String(i));
    } else opts = d.options ?? [];
    const desc = d.description ? `<span class="tl-dim-desc">${esc(d.description)}</span>` : '';
    return `<div class="tl-dim-row"><div class="tl-dim-label">${esc(d.label)}${desc}</div><div class="tl-opts">${opts.map((o) => `<button class="tl-opt">${esc(o)}</button>`).join('')}</div></div>`;
  }).join('');
  return `<div class="tl-score"><div class="tl-score-head">Score · rubric <code>${esc(r.id)}@${esc(r.version)}</code></div>${dims}<textarea class="tl-comment" placeholder="Comment / corrected output — fed back into dataset &amp; judge-calibration…"></textarea><button class="tl-submit">Submit judgment →</button></div>`;
}

/** review-ui's built-in styles (shared by the demo and embeds). */
export const CSS = `
:root{--bg:#f6f8fa;--card:#fff;--border:#e6e9ee;--text:#1f2733;--text2:#5b6472;--accent:#2563eb;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
.tl-conv{display:flex;flex-direction:column;gap:12px}
.tl-turn{border:1px solid var(--border);border-radius:12px;background:var(--card);padding:10px 14px}
.tl-user{background:#eff5ff;border-color:#dbe7ff}
.tl-tool{background:#fafbfc}
.tl-turn-head{font-size:12px;font-weight:600;color:var(--text2);margin-bottom:6px;display:flex;gap:8px;align-items:center}
.tl-turn-agent{font-weight:500;color:var(--accent);background:#e8f0fe;padding:1px 8px;border-radius:10px;font-size:11px}
.tl-mbs{display:inline-flex;gap:4px;margin-left:auto;flex-wrap:wrap}
.tl-mb{font-size:10px;color:var(--text2);background:#eef1f5;border-radius:5px;padding:0 6px;font-weight:500;white-space:nowrap}
.tl-mb-type{background:#e8eefb;color:#3551b5}
.tl-mb-err{background:#fdecea;color:#c0392b}
.tl-text,.tl-md{font-size:14px}
.tl-md p{margin:.3em 0}.tl-md ul{margin:.3em 0;padding-left:1.3em}
.tl-code{background:#0f172a;color:#e2e8f0;padding:10px 12px;border-radius:8px;overflow:auto;font-family:var(--mono);font-size:12px;margin:6px 0}
.tl-card{border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin:4px 0;background:#fcfdff}
.tl-card-title{font-weight:600;font-size:13px}.tl-card-title a{color:var(--accent);text-decoration:none}
.tl-card-sub{color:var(--text2);font-size:12px}
.tl-card-body{font-size:12.5px;color:var(--text2);margin-top:3px}
.tl-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.tl-badge{padding:1px 7px;border-radius:6px;font-size:11px;font-weight:600}
.tl-tool{border:1px dashed #c7cdd6;border-radius:10px;padding:8px 10px;margin:6px 0;background:#fff}
.tl-tool-head{font-size:12.5px}
.tl-tool-st{color:var(--text2);font-size:11px;border:1px solid var(--border);border-radius:6px;padding:0 6px;margin-left:6px}
.tl-tool-res{margin-top:4px}
/* Agent process tree (observations): collapsible section; each step is a full, always-expanded turn (indented by depth) */
.tl-steps{margin-top:12px;border:1px solid var(--border);border-radius:12px;background:#fbfcfe;padding:2px 6px}
.tl-steps-sum{cursor:pointer;font-size:12px;font-weight:700;color:var(--text2);padding:8px;list-style:none;user-select:none}
.tl-steps-sum::-webkit-details-marker{display:none}
.tl-steps-sum::before{content:'▸ ';color:var(--accent)}
.tl-steps[open] .tl-steps-sum::before{content:'▾ '}
.tl-steps-sum:hover{color:var(--text)}
.tl-steps-body{display:flex;flex-direction:column;gap:6px;padding:2px 4px 10px}
.tl-steps .tl-turn{padding:6px 10px;border-radius:9px}
.tl-steps .tl-turn-head{font-size:11px;margin-bottom:4px}
.tl-steps .tl-text,.tl-steps .tl-md{font-size:12.5px}
.tl-steps .tl-tool{margin:4px 0}
.tl-steps .tl-code{font-size:11px;padding:8px 10px}
.tl-table{border-collapse:collapse;width:100%;font-size:12.5px;margin:6px 0}
.tl-table th,.tl-table td{border:1px solid var(--border);padding:7px 10px;vertical-align:top;text-align:left}
.tl-table th{background:#f0f3f7;font-weight:600}
.tl-table td.tl-dim{font-weight:600;background:#f7f9fb;white-space:nowrap}
.tl-hr{border:none;border-top:1px solid var(--border);margin:8px 0}
.tl-img,.tl-card-img{max-width:100%;border-radius:8px}
.tl-conv-title{font-size:13px;color:var(--text2);margin-bottom:4px}
.tl-score{border:1px solid var(--border);border-radius:12px;background:var(--card);padding:14px 16px}
.tl-score-head{font-weight:700;margin-bottom:10px}.tl-score-head code{background:#eef1f5;padding:1px 6px;border-radius:5px;font-size:12px}
.tl-dim-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0;border-top:1px solid #f0f2f5}
.tl-dim-label{font-size:13px;font-weight:500}.tl-dim-desc{display:block;font-weight:400;color:var(--text2);font-size:11px}
.tl-opts{display:flex;gap:6px;flex-wrap:wrap}
.tl-opt{border:1px solid var(--border);background:#fff;border-radius:8px;padding:4px 11px;cursor:pointer;font-size:13px}
.tl-opt:hover{border-color:var(--accent);color:var(--accent)}
.tl-comment{width:100%;margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:8px;font-size:12.5px;min-height:54px;font-family:inherit;resize:vertical}
.tl-submit{margin-top:8px;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font-weight:600;font-size:13px}
`;

export * from './calibration-html.ts';
