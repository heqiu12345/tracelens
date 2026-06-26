/**
 * FeedbackSink — the key interface for "injecting human judgment back into the AI engineering loop".
 *
 * The output of a human review (scores / corrections / good-bad) is not just stored as a score; it
 * can fan out to multiple destinations:
 *  - score      : write back to the data source (e.g. a Langfuse score)
 *  - dataset    : mark the sample into a dataset (the "build datasets" stage of the loop)
 *  - calibration: use the human score as ground truth to calibrate the LLM-judge (the "evaluate" stage of the loop)
 *
 * This turns tracelens from a "review endpoint" into a judgment-injection pump within the loop —
 * using human judgment to prevent agent slop.
 */
export interface Judgment {
  traceId: string;
  sessionId?: string;
  rubricId: string;
  rubricVersion: string;
  /** dimension.key -> score value. */
  scores: Record<string, number | string | boolean>;
  /** Overall verdict. */
  verdict?: 'good' | 'bad' | 'unsure';
  comment?: string;
  /** The human's correction of "what it should have output" (the golden signal that feeds the dataset). */
  correctedOutput?: string;
  reviewer?: string;
  /** ISO time; injected by the caller (the framework does not read the system clock, keeping it a testable pure function). */
  at?: string;
}

/** The destination of a judgment's output. A single review can be submitted to multiple sinks at once. */
export interface FeedbackSink {
  name: string;
  /** This sink's destination category, for declaration / display only. */
  kind: 'score' | 'dataset' | 'calibration';
  submit(j: Judgment): Promise<void>;
}
