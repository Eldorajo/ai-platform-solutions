/**
 * Tests for the runner: caching, budget stop, infra retries, agent crashes.
 * Dependencies: node:test, node:assert, ../src
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Budget, MemoryCache, runJobs, runTrial } from '../src/runner.ts';
import { InfraError } from '../src/types.ts';
import type { Agent, Task } from '../src/types.ts';

const task: Task = {
  id: 't1',
  category: 'refund eligible',
  ticket: 'refund #A1',
  customerId: 'C1',
  fixture: { orders: [{ id: 'A1', customerId: 'C1', totalCents: 500, status: 'delivered', deliveredDaysAgo: 1 }], kb: [] },
  expect: { acceptable: [[{ kind: 'refunded', orderId: 'A1', amountCents: 500 }]], forbidden: [] },
};

const usage = { inputTokens: 1, outputTokens: 1, costUsd: 0.01 };

function countingAgent(behave: (n: number) => 'ok' | 'infra' | 'crash'): Agent & { calls: number } {
  const agent = {
    version: 'v1',
    calls: 0,
    async run(_input: { ticket: string; customerId: string }, tools: Parameters<Agent['run']>[1]) {
      const what = behave(agent.calls++);
      if (what === 'infra') throw new InfraError('503');
      if (what === 'crash') throw new Error('bad tool call');
      await tools.issue_refund('A1', 500);
      return { finalMessage: 'done', usage };
    },
  };
  return agent;
}

test('grades a run and caches it, so a repeat costs nothing', async () => {
  const agent = countingAgent(() => 'ok');
  const cache = new MemoryCache();
  const budget = new Budget(1);
  const first = await runTrial(agent, task, 0, { cache, budget });
  const again = await runTrial(agent, task, 0, { cache, budget });
  assert.equal(first!.result.passed, true);
  assert.equal(first!.fromCache, false);
  assert.equal(again!.fromCache, true);
  assert.equal(agent.calls, 1);
  assert.equal(budget.spentUsd, 0.01);
});

test('editing a task invalidates its cached results', async () => {
  const agent = countingAgent(() => 'ok');
  const opts = { cache: new MemoryCache(), budget: new Budget(1) };
  await runTrial(agent, task, 0, opts);
  await runTrial(agent, { ...task, ticket: 'refund #A1 please' }, 0, opts);
  assert.equal(agent.calls, 2);
});

test('provider outages are retried and do not count as agent failures', async () => {
  const agent = countingAgent((n) => (n < 2 ? 'infra' : 'ok'));
  const out = await runTrial(agent, task, 0, { cache: new MemoryCache(), budget: new Budget(1), infraRetries: 2 });
  assert.equal(out!.result.passed, true);
  assert.equal(agent.calls, 3);
});

test('a lasting outage stops the run instead of recording fake failures', async () => {
  const agent = countingAgent(() => 'infra');
  await assert.rejects(runTrial(agent, task, 0, { cache: new MemoryCache(), budget: new Budget(1), infraRetries: 1 }), InfraError);
});

test('an agent crash is a failed run, not a harness error', async () => {
  const out = await runTrial(countingAgent(() => 'crash'), task, 0, { cache: new MemoryCache(), budget: new Budget(1) });
  assert.equal(out!.result.passed, false);
  assert.match(out!.result.reason, /agent error: bad tool call/);
});

test('stops at the budget and says the run is incomplete', async () => {
  const agent = countingAgent(() => 'ok');
  const jobs = Array.from({ length: 10 }, (_, trial) => ({ task, trial }));
  const out = await runJobs(agent, jobs, { cache: new MemoryCache(), budget: new Budget(0.03), concurrency: 1 });
  assert.equal(out.results.length, 3);
  assert.equal(out.incomplete, true);
});
