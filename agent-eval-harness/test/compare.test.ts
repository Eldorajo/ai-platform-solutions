/**
 * Tests for the ship gate: each rule, and that the decision is reproducible.
 * Dependencies: node:test, node:assert, ../src
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapCi, compare } from '../src/compare.ts';
import type { Task, TrialResult } from '../src/types.ts';

const tasks: Task[] = Array.from({ length: 40 }, (_, i) => ({
  id: `t${i}`,
  category: i < 20 ? 'a' : 'b',
  ticket: '',
  customerId: '',
  fixture: { orders: [], kb: [] },
  expect: { acceptable: [], forbidden: [] },
}));

/** Builds results: `pass(taskIndex, trial)` and optional `critical(taskIndex, trial)`. */
function results(
  version: string,
  trials: number,
  pass: (i: number, t: number) => boolean,
  critical: (i: number, t: number) => boolean = () => false,
): TrialResult[] {
  return tasks.flatMap((task, i) =>
    Array.from({ length: trials }, (_, t) => {
      const crit = critical(i, t);
      return { taskId: task.id, trial: t, agentVersion: version, passed: !crit && pass(i, t), critical: crit, reason: crit ? 'forbidden: x' : '', costUsd: 0 };
    }),
  );
}

test('ships an equal-or-better change', () => {
  const base = results('b', 5, (i) => i % 10 !== 0);
  const cand = results('c', 5, () => true);
  assert.equal(compare(tasks, base, cand).decision, 'ship');
});

test('blocks a clear overall regression', () => {
  const base = results('b', 5, () => true);
  const cand = results('c', 5, (i) => i % 3 !== 0);
  const c = compare(tasks, base, cand);
  assert.equal(c.decision, 'block');
  assert.match(c.reasons[0]!, /overall pass rate fell/);
});

test('blocks a category loss hidden by a gain elsewhere', () => {
  const base = results('b', 5, (i) => i >= 20 ? i % 2 === 0 : true);
  const cand = results('c', 5, (i) => (i < 20 ? i % 4 !== 0 : true));
  const c = compare(tasks, base, cand);
  assert.ok(c.overall.delta > 0);
  assert.equal(c.decision, 'block');
  assert.match(c.reasons[0]!, /category "a" fell/);
});

test('blocks when forbidden actions clearly rise', () => {
  const base = results('b', 5, () => true);
  const cand = results('c', 5, () => true, (i, t) => i % 4 === 0 && t === 0);
  const c = compare(tasks, base, cand);
  assert.equal(c.decision, 'block');
  assert.match(c.reasons[0]!, /forbidden actions rose/);
  assert.equal(c.reviewQueue.length, 10);
});

test('a forbidden action that is just chance gives inconclusive, never ship', () => {
  const base = results('b', 5, () => true, (i, t) => i === 1 && t === 0);
  const cand = results('c', 5, () => true, (i, t) => i === 2 && t === 0);
  const c = compare(tasks, base, cand);
  assert.equal(c.decision, 'inconclusive');
  assert.deepEqual(c.reviewQueue, [{ taskId: 't2', trial: 0, reason: 'forbidden: x', baselineAlsoDid: false }]);
});

test('notes when the baseline makes the same mistake', () => {
  const base = results('b', 5, () => true, (i, t) => i === 2 && t === 1);
  const cand = results('c', 5, () => true, (i, t) => i === 2 && t === 0);
  assert.equal(compare(tasks, base, cand).reviewQueue[0]!.baselineAlsoDid, true);
});

test('too little evidence is inconclusive', () => {
  const few = tasks.slice(0, 4);
  const base = results('b', 1, (i) => i % 2 === 0).filter((r) => few.some((t) => t.id === r.taskId));
  const cand = results('c', 1, (i) => i % 2 === 1).filter((r) => few.some((t) => t.id === r.taskId));
  assert.equal(compare(few, base, cand).decision, 'inconclusive');
});

test('the same data always gives the same interval', () => {
  const d = [0.1, -0.2, 0, 0.3, 0.05];
  assert.deepEqual(bootstrapCi(d, 500, 7), bootstrapCi(d, 500, 7));
  const [lo, hi] = bootstrapCi(d, 2000, 1);
  assert.ok(lo < 0.05 && hi > 0.05);
});
