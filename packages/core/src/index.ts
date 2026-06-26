/**
 * @tracelens/core — the framework contracts: 4 pluggable interfaces + UI primitives.
 *
 * The core is deliberately free of domain logic (no domain-specific wording anywhere). All domain
 * concerns live in plugins:
 *   - DataSource  : fetch/write-back (adapter, first up: Langfuse)
 *   - Renderer    : trace → readable conversation (the core differentiator; see examples/custom-tag-chatbot)
 *   - Rubric      : versioned scoring dimensions
 *   - FeedbackSink: inject judgment back into the loop (score / dataset / judge-calibration)
 */
export * from './primitives.ts';
export * from './datasource.ts';
export * from './renderer.ts';
export * from './rubric.ts';
export * from './feedback.ts';
