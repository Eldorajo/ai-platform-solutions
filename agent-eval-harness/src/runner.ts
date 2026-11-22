/**
 * Runs an agent on tasks: sandboxes each run, grades it, caches results and stops at a budget.
 *
 * Cost decisions:
 * - Cache every graded run, keyed by agent version + task content + trial
 *   number. The baseline is already cached from earlier weeks, so a weekly
 *   check mostly pays only for the candidate.
 * - Editing a task changes its hash, so stale results are never reused.
 * - A hard budget: when it runs out, the run stops and is marked incomplete
 *   instead of quietly spending more.
 * Dependencies: node:crypto, ./sandbox.ts, ./grade.ts, ./types.ts
 */
import { createHash } from 'node:crypto';
import { createSandbox } from './sandbox.ts';
import { grade } from './grade.ts';
import { InfraError } from './types.ts';
import type { Agent, Task, TrialResult } from './types.ts';

/** Where graded runs are stored. In-memory here; a table or bucket in real use. */
export interface ResultCache {
  get(key: string): Promise<TrialResult | undefined>;
  set(key: string, result: TrialResult): Promise<void>;
}

export class MemoryCache implements ResultCache {
  readonly store = new Map<string, TrialResult>();
  async get(key: string) {
    return this.store.get(key);
  }
  async set(key: string, result: TrialResult) {
    this.store.set(key, result);
  }
}

/** Tracks money spent across one evaluation. */
export class Budget {
  spentUsd = 0;
  readonly limitUsd: number;
  constructor(limitUsd: number) {
    this.limitUsd = limitUsd;
  }
  get exhausted() {
    return this.spentUsd >= this.limitUsd;
  }
}

export interface RunOptions {
  cache: ResultCache;
  budget: Budget;
  /** Parallel runs. Bounded so we stay under provider rate limits. */
  concurrency?: number;
  /** Retries for InfraError only; provider outages shouldn't count against the agent. */
  infraRetries?: number;
}

/** Hash of the task's content, so editing a task invalidates its cached results. */
export function taskHash(task: Task): string {
  return createHash('sha256').update(JSON.stringify(task)).digest('hex').slice(0, 12);
}

/**
 * Runs and grades one trial, or returns the cached result.
 *
 * @param agent - Agent under test.
 * @param task - The task.
 * @param trial - Trial number, 0-based. Part of the cache key.
 * @param opts - Cache, budget and retries.
 * @returns The graded result, `fromCache`, or null if the budget ran out first.
 */
export async function runTrial(
  agent: Agent,
  task: Task,
  trial: number,
  opts: RunOptions,
): Promise<{ result: TrialResult; fromCache: boolean } | null> {
  const key = `${agent.version}:${task.id}:${taskHash(task)}:${trial}`;
  const cached = await opts.cache.get(key);
  if (cached) return { result: cached, fromCache: true };
  if (opts.budget.exhausted) return null;

  const retries = opts.infraRetries ?? 2;
  for (let attempt = 0; ; attempt++) {
    const sandbox = createSandbox(task.fixture);
    try {
      const out = await agent.run({ ticket: task.ticket, customerId: task.customerId }, sandbox.tools);
      opts.budget.spentUsd += out.usage.costUsd;
      const g = grade(task.expect, { finalMessage: out.finalMessage, calls: sandbox.calls });
      const result: TrialResult = { taskId: task.id, trial, agentVersion: agent.version, ...g, costUsd: out.usage.costUsd };
      await opts.cache.set(key, result);
      return { result, fromCache: false };
    } catch (err) {
      if (err instanceof InfraError && attempt < retries) continue;
      if (err instanceof InfraError) throw err; // still down after retries: stop, don't record a fake failure
      // Anything else is the agent's own failure (bad tool use, crash) and counts as a failed run.
      const result: TrialResult = {
        taskId: task.id,
        trial,
        agentVersion: agent.version,
        passed: false,
        critical: false,
        reason: `agent error: ${(err as Error).message}`,
        costUsd: 0,
      };
      await opts.cache.set(key, result);
      return { result, fromCache: false };
    }
  }
}

/**
 * Runs the given trials with bounded concurrency.
 *
 * @param agent - Agent under test.
 * @param jobs - (task, trial) pairs to run.
 * @param opts - Cache, budget, concurrency.
 * @returns Results, how many were fresh runs, and whether the budget cut it short.
 */
export async function runJobs(agent: Agent, jobs: { task: Task; trial: number }[], opts: RunOptions) {
  const results: TrialResult[] = [];
  let fresh = 0;
  let incomplete = false;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const out = await runTrial(agent, job.task, job.trial, opts);
      if (!out) {
        incomplete = true;
        continue;
      }
      results.push(out.result);
      if (!out.fromCache) fresh++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 8) }, worker));
  return { results, fresh, incomplete };
}
