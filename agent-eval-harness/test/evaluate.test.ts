/**
 * Tests for adaptive trials: extra runs go only to uncertain tasks, and cached work is reused.
 * Dependencies: node:test, node:assert, ../src, ../examples
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/evaluate.ts';
import { Budget, MemoryCache } from '../src/runner.ts';
import { buildSuite } from '../examples/suite.ts';
import { fakeAgent, type Knobs } from '../examples/fake-agent.ts';

const perfect: Knobs = { wrongArticle: 0, ignoreEscalation: 0, skipWindowCheck: 0, offerReplacement: 0, crash: 0, infraFlake: 0 };

test('consistent tasks stop at the initial trials', async () => {
  const tasks = buildSuite().slice(0, 10);
  const e = await evaluate(fakeAgent('a', perfect), fakeAgent('b', perfect), tasks, {
    cache: new MemoryCache(),
    budget: new Budget(5),
  });
  assert.deepEqual([...e.trialsPerTask.values()], Array(10).fill(3));
  assert.equal(e.freshRuns, 60);
});

test('uncertain tasks get more trials, up to the cap', async () => {
  const tasks = buildSuite().filter((t) => t.category === 'how-to question').slice(0, 5);
  const e = await evaluate(fakeAgent('a', perfect), fakeAgent('b', { ...perfect, wrongArticle: 0.5 }), tasks, {
    cache: new MemoryCache(),
    budget: new Budget(5),
    maxTrials: 9,
  });
  assert.ok([...e.trialsPerTask.values()].some((n) => n > 3));
  assert.ok([...e.trialsPerTask.values()].every((n) => n <= 9));
});

test('a second evaluation against the same baseline reuses its cached runs', async () => {
  const tasks = buildSuite().slice(0, 10);
  const cache = new MemoryCache();
  const base = fakeAgent('a', perfect);
  await evaluate(base, fakeAgent('b', perfect), tasks, { cache, budget: new Budget(5) });
  const second = await evaluate(base, fakeAgent('c', perfect), tasks, { cache, budget: new Budget(5) });
  assert.equal(second.freshRuns, 30);
});

test('running out of budget is never a ship', async () => {
  const tasks = buildSuite().slice(0, 10);
  const e = await evaluate(fakeAgent('a', perfect), fakeAgent('b', perfect), tasks, {
    cache: new MemoryCache(),
    budget: new Budget(0.05),
  });
  assert.equal(e.incomplete, true);
  assert.equal(e.decision, 'inconclusive');
});
