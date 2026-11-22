/**
 * The entry point: evaluate a candidate against the baseline, spending trials where they matter.
 *
 * Adaptive trials: every task gets a few runs first. Most tasks give the same
 * answer every time and need nothing more. Extra runs go only to tasks whose
 * result is mixed or differs between versions; that's where the noise lives.
 * This cuts cost compared with a flat high trial count.
 * Dependencies: ./runner.ts, ./compare.ts, ./types.ts
 */
import { runJobs, type RunOptions } from './runner.ts';
import { compare, rates, type Comparison, type GateOptions } from './compare.ts';
import type { Agent, Task, TrialResult } from './types.ts';

export interface EvaluateOptions extends RunOptions, GateOptions {
  /** Trials per task in the first round. */
  initialTrials?: number;
  /** Trials added to an uncertain task per extra round. */
  stepTrials?: number;
  /** Most trials any task gets. */
  maxTrials?: number;
}

export interface Evaluation extends Comparison {
  freshRuns: number;
  costUsd: number;
  incomplete: boolean;
  trialsPerTask: Map<string, number>;
}

/** A task needs more runs if either version is mixed on it, or the versions disagree. */
function uncertain(b: { pass: number; n: number }, c: { pass: number; n: number }) {
  const rb = b.pass / b.n;
  const rc = c.pass / c.n;
  return (rb > 0 && rb < 1) || (rc > 0 && rc < 1) || rb !== rc;
}

/**
 * Runs both versions on the suite and returns the ship decision.
 *
 * @param baseline - Current production agent. Usually all cached.
 * @param candidate - The change under review.
 * @param tasks - The suite.
 * @param opts - Run, gate and trial settings.
 * @returns Comparison, decision, and what it cost.
 */
export async function evaluate(baseline: Agent, candidate: Agent, tasks: Task[], opts: EvaluateOptions): Promise<Evaluation> {
  const initial = opts.initialTrials ?? 3;
  const step = opts.stepTrials ?? 3;
  const max = opts.maxTrials ?? 9;
  const startSpent = opts.budget.spentUsd;

  const trialsPerTask = new Map(tasks.map((t) => [t.id, 0]));
  const base: TrialResult[] = [];
  const cand: TrialResult[] = [];
  let freshRuns = 0;
  let incomplete = false;

  let pending = tasks;
  let add = initial;
  while (pending.length > 0 && !incomplete) {
    const jobs = pending.flatMap((task) => {
      const from = trialsPerTask.get(task.id)!;
      return Array.from({ length: add }, (_, i) => ({ task, trial: from + i }));
    });
    const [rb, rc] = [await runJobs(baseline, jobs, opts), await runJobs(candidate, jobs, opts)];
    base.push(...rb.results);
    cand.push(...rc.results);
    freshRuns += rb.fresh + rc.fresh;
    incomplete = rb.incomplete || rc.incomplete;
    for (const task of pending) trialsPerTask.set(task.id, trialsPerTask.get(task.id)! + add);

    const b = rates(base);
    const c = rates(cand);
    pending = pending.filter(
      (t) => trialsPerTask.get(t.id)! < max && b.has(t.id) && c.has(t.id) && uncertain(b.get(t.id)!, c.get(t.id)!),
    );
    add = step;
  }

  const comparison = compare(tasks, base, cand, opts);
  if (incomplete) {
    comparison.decision = 'inconclusive';
    comparison.reasons.unshift('budget ran out before the evaluation finished');
  }
  return { ...comparison, freshRuns, costUsd: opts.budget.spentUsd - startSpent, incomplete, trialsPerTask };
}
