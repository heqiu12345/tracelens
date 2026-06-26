/**
 * Parse a chatbot's custom tag protocol (comparison table <table>/<row>, product tags, etc.).
 * Responsible only for parsing, not rendering — rendering is the renderer's job, mapping into
 * tracelens UI primitives.
 *
 * This kind of "domain protocol parsing" is exactly the small piece of plugin code every
 * project writes for its own agent.
 */

export interface RowNode {
  name: string;
  type: string;
  value?: string;
  values: unknown[] | null;
}

export type Segment =
  | { kind: 'text'; content: string }
  | { kind: 'table'; rows: RowNode[] };

const ATTR_RE = /([\w-]+)="([^"]*)"/g;

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrStr)) !== null) {
    const k = m[1];
    if (k) attrs[k] = m[2] ?? '';
  }
  return attrs;
}

/** Match from s[open] ('[') to its corresponding ']', skipping brackets inside double-quoted strings. */
function matchBracket(s: string, open: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return i; }
  }
  return s.length - 1;
}

function parseJsonLoose(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** Parse all <row .../> entries inside a table block. */
export function parseRows(inner: string): RowNode[] {
  const rows: RowNode[] = [];
  let idx = 0;
  for (;;) {
    const rs = inner.indexOf('<row', idx);
    if (rs < 0) break;
    const vPos = inner.indexOf('values=', rs);
    const closePos = inner.indexOf('/>', rs);
    let attrsStr: string;
    let values: unknown[] | null = null;
    let tagEnd: number;
    if (vPos >= 0 && (closePos < 0 || vPos < closePos)) {
      const bs = inner.indexOf('[', vPos);
      const be = matchBracket(inner, bs);
      const arr = parseJsonLoose(inner.slice(bs, be + 1));
      values = Array.isArray(arr) ? arr : null;
      attrsStr = inner.slice(rs, vPos);
      tagEnd = inner.indexOf('/>', be);
    } else {
      attrsStr = inner.slice(rs, closePos);
      tagEnd = closePos;
    }
    const attrs = parseAttrs(attrsStr);
    rows.push({ name: attrs.name ?? '', type: attrs.type ?? '', value: attrs.value, values });
    idx = (tagEnd >= 0 ? tagEnd : rs) + 2;
  }
  return rows;
}

/** Split a reply into ordered segments: text segments / comparison-table segments (<table type="start"/> … <table type="end"/>). */
export function splitBotReplySegments(text: string): Segment[] {
  const segs: Segment[] = [];
  if (!text) return [{ kind: 'text', content: text ?? '' }];
  const START = /<table\s+type="start"\s*\/>/;
  const END = /<table\s+type="end"\s*\/>/;
  let rest = text;
  for (;;) {
    const sm = rest.match(START);
    if (!sm) { if (rest) segs.push({ kind: 'text', content: rest }); break; }
    const start = sm.index ?? 0;
    const before = rest.slice(0, start);
    if (before) segs.push({ kind: 'text', content: before });
    const after = rest.slice(start + sm[0].length);
    const em = after.match(END);
    if (!em) { segs.push({ kind: 'table', rows: parseRows(after) }); break; }
    const end = em.index ?? 0;
    segs.push({ kind: 'table', rows: parseRows(after.slice(0, end)) });
    rest = after.slice(end + em[0].length);
  }
  return segs;
}
