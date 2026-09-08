import { projectRun, settleRun } from './run-accounting';
import { runConformanceSuite } from './conformance-suite';
import type { ConformanceAdapter, EngineState } from './conformance-suite';

/**
 * Submits `run-accounting.ts` to the ADR-011 conformance suite.
 *
 * The adapter is the whole cost of entering an engine into the comparison:
 * anything that can project, settle and reduce a fractional duration can be
 * checked against the same oracle, and the outcome is an objective criterion
 * rather than a preference.
 */
const adapter: ConformanceAdapter = {
  name: 'run-accounting',

  project: (state: EngineState, atMs: number) => {
    const result = projectRun(state, atMs);
    if (!result.ok) throw new Error(`engine refused a valid state: ${result.reason}`);
    return result.value;
  },

  settle: (state: EngineState, atMs: number) => {
    const result = settleRun(state, atMs);
    if (!result.ok) throw new Error(`engine refused a valid state: ${result.reason}`);
    return result.value;
  },

  // The engine itself accepts only whole milliseconds and refuses anything else
  // with INVALID_INSTANT, so the reduction belongs to the caller. This is the
  // expression the SQL boundary must implement: a floor, never a ceiling, and
  // never negative.
  wholeMillisecondsBetween: (anchorMs: number, nowMs: number) =>
    Math.max(0, Math.floor(nowMs - anchorMs)),
};

runConformanceSuite(adapter);
