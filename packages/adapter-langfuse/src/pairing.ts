import type { ScoreRecord } from '../../core/src/index.ts';

/** One side's value within a pair. */
export interface SideValue { value: number | string | boolean; comment?: string; timestamp?: string; }
/** A pair: "the human score vs the judge score for the same (trace, dimension)." */
export interface PairedScore { traceId: string; dimension: string; human: SideValue; judge: SideValue; }
/** Pairing result (with the honest denominator). */
export interface PairingResult { pairs: PairedScore[]; pairedTraces: number; totalTraces: number; }
/** An explicit mapping from judge score name → human dimension name. */
export type PairingMapping = Record<string, string>;

type Side = 'human' | 'judge';

/** Normalize the source: ANNOTATION/user/human → human; EVAL → judge; everything else is ignored. */
export function normalizeSide(source?: string): Side | undefined {
  const s = (source ?? '').toLowerCase();
  if (s === 'eval') return 'judge';
  if (s === 'human' || s === 'user' || s === 'annotation') return 'human';
  return undefined;
}

/** Whether a is newer than b (a missing timestamp counts as older; if a is missing, don't update; if b is missing, a wins). */
function isNewer(a?: string, b?: string): boolean {
  if (!a) return false;
  if (!b) return true;
  const ta = Date.parse(a), tb = Date.parse(b);
  if (Number.isNaN(ta)) return false;
  if (Number.isNaN(tb)) return true;
  return ta >= tb;
}

/**
 * Pair a batch of scores into "human vs judge" by (trace, dimension).
 * By default matches on identical name + source; when a mapping is provided, judge names are
 * folded onto human dimensions via the mapping.
 * Only includes pairs that have both sides (the honest denominator); for multiple scores on the
 * same (trace, dimension, side), keep the latest.
 */
export function pairScores(scores: ScoreRecord[], opts: { mapping?: PairingMapping } = {}): PairingResult {
  const mapping = opts.mapping ?? {};
  const byTrace = new Map<string, ScoreRecord[]>();
  for (const s of scores) {
    if (!s.traceId) continue;
    const arr = byTrace.get(s.traceId) ?? [];
    arr.push(s);
    byTrace.set(s.traceId, arr);
  }

  const pairs: PairedScore[] = [];
  let pairedTraces = 0;
  for (const [traceId, list] of byTrace) {
    const humans = new Map<string, SideValue>();
    const judges = new Map<string, SideValue>();
    for (const s of list) {
      const side = normalizeSide(s.source);
      if (!side) continue;
      const dim = side === 'judge' ? (mapping[s.name] ?? s.name) : s.name;
      const bucket = side === 'human' ? humans : judges;
      const cur: SideValue = { value: s.value, comment: s.comment, timestamp: s.timestamp };
      const prev = bucket.get(dim);
      if (!prev || isNewer(cur.timestamp, prev.timestamp)) bucket.set(dim, cur);
    }
    let paired = false;
    for (const [dim, human] of humans) {
      const judge = judges.get(dim);
      if (judge) { pairs.push({ traceId, dimension: dim, human, judge }); paired = true; }
    }
    if (paired) pairedTraces++;
  }
  return { pairs, pairedTraces, totalTraces: byTrace.size };
}
