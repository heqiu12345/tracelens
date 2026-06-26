import type { RawTrace } from './datasource.ts';

/**
 * Rubric (versioned scoring rules).
 *
 * Scoring standards evolve with the agent version → a rubric carries a `version` and is routed by
 * a trace's tag/metadata, ensuring traces of different versions are scored with the corresponding
 * rubric version. It serves the "calibrate" part of the AI engineering loop.
 */
export type ScaleType = 'binary' | 'numeric' | 'categorical';

export interface Dimension {
  key: string;
  label: string;
  description?: string;
  scale: ScaleType;
  /** numeric: [min, max]. */
  range?: [number, number];
  /** categorical: allowed values. */
  options?: string[];
}

export interface Rubric {
  id: string;
  version: string;
  dimensions: Dimension[];
  /** Applicability condition: routed by tag/metadata (the heart of versioning). Omitted means it is treated as a generic fallback. */
  appliesTo?: { tags?: string[]; metadata?: Record<string, string> };
}

export interface RubricRegistry {
  /** Given a trace, resolve the applicable rubric (version routing). */
  resolve(trace: RawTrace): Rubric | undefined;
  all(): Rubric[];
}
