/**
 * Tests for grading: outcomes over text, several valid answers, forbidden actions override.
 * Dependencies: node:test, node:assert, ../src
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, holds } from '../src/grade.ts';
import { createSandbox } from '../src/sandbox.ts';
import type { Expectation, ToolCall } from '../src/types.ts';

const refund = (orderId: string, amountCents: number, ok = true): ToolCall => ({ tool: 'issue_refund', args: { orderId, amountCents }, ok });

const damaged: Expectation = {
  acceptable: [
    [{ kind: 'refunded', orderId: 'A1', amountCents: 500 }],
    [{ kind: 'noRefund' }, { kind: 'mentionsAnyOf', phrases: ['replacement'] }],
  ],
  forbidden: [{ kind: 'refundedOtherThan', orderId: 'A1' }],
};

test('either valid answer passes', () => {
  assert.equal(grade(damaged, { finalMessage: 'Refunded.', calls: [refund('A1', 500)] }).passed, true);
  assert.equal(grade(damaged, { finalMessage: "We'll send a Replacement.", calls: [] }).passed, true);
});

test('a failed refund call does not count as a refund', () => {
  const g = grade(damaged, { finalMessage: 'Refunded.', calls: [refund('A1', 500, false)] });
  assert.equal(g.passed, false);
  assert.equal(g.critical, false);
});

test('a forbidden action fails the run even when the right outcome also happened', () => {
  const g = grade(damaged, { finalMessage: 'Refunded.', calls: [refund('A1', 500), refund('B9', 100)] });
  assert.deepEqual(g, { passed: false, critical: true, reason: 'forbidden: refund on an order other than A1' });
});

test('failure reasons name what was missing from the closest outcome (ties: the first listed)', () => {
  const g = grade(damaged, { finalMessage: 'Sorry about that.', calls: [] });
  assert.equal(g.reason, 'missing: refund A1 500c');
  const nearReplacement: Expectation = {
    acceptable: [
      [{ kind: 'refunded', orderId: 'A1', amountCents: 500 }, { kind: 'mentionsAnyOf', phrases: ['refunded'] }],
      [{ kind: 'noRefund' }, { kind: 'mentionsAnyOf', phrases: ['replacement'] }],
    ],
    forbidden: [],
  };
  assert.equal(grade(nearReplacement, { finalMessage: 'Sorry about that.', calls: [] }).reason, 'missing: mention "replacement"');
});

test('wrong refund amount is not the expected outcome', () => {
  assert.equal(holds({ kind: 'refunded', orderId: 'A1', amountCents: 500 }, { finalMessage: '', calls: [refund('A1', 499)] }), false);
  assert.equal(holds({ kind: 'refunded', orderId: 'A1' }, { finalMessage: '', calls: [refund('A1', 499)] }), true);
});

test('citations and over-limit refunds are detected', () => {
  assert.equal(holds({ kind: 'citesAnyOf', articleIds: ['KB-103', 'KB-106'] }, { finalMessage: 'See [kb-106].', calls: [] }), true);
  assert.equal(holds({ kind: 'refundOver', cents: 20_000 }, { finalMessage: '', calls: [refund('A1', 20_001)] }), true);
  assert.equal(holds({ kind: 'refundOver', cents: 20_000 }, { finalMessage: '', calls: [refund('A1', 20_000)] }), false);
});

test('the sandbox rejects what the real API would, and records it', async () => {
  const sb = createSandbox({ orders: [{ id: 'A1', customerId: 'C1', totalCents: 500, status: 'delivered', deliveredDaysAgo: 1 }], kb: [] });
  await assert.rejects(sb.tools.issue_refund('A1', 501), /exceeds order total/);
  await assert.rejects(sb.tools.issue_refund('NOPE', 1), /not found/);
  await assert.rejects(sb.tools.issue_refund('A1', 1.5), /whole number/);
  assert.deepEqual(sb.calls.map((c) => c.ok), [false, false, false]);
});

test('each sandbox starts clean, so trials cannot leak state into each other', async () => {
  const fixture = { orders: [{ id: 'A1', customerId: 'C1', totalCents: 500, status: 'delivered' as const }], kb: [] };
  const one = createSandbox(fixture);
  const order = await one.tools.lookup_order('A1');
  order!.totalCents = 1;
  const two = createSandbox(fixture);
  assert.equal((await two.tools.lookup_order('A1'))!.totalCents, 500);
  assert.equal(two.calls.length, 1);
});
