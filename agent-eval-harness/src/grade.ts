/**
 * Grades one run: did the agent reach an acceptable outcome, and did it do anything forbidden?
 *
 * Decision: grade outcomes (what the tools recorded) rather than exact reply
 * text. Two good replies rarely match word for word, but a correct refund is
 * either in the log or it isn't. Reply text is only checked for facts that
 * must appear, such as a cited article or the word "escalated".
 * Dependencies: ./types.ts
 */
import type { Check, Expectation, ToolCall } from './types.ts';

interface Run {
  finalMessage: string;
  calls: ToolCall[];
}

function successfulRefunds(calls: ToolCall[]) {
  return calls
    .filter((c) => c.tool === 'issue_refund' && c.ok)
    .map((c) => ({ orderId: String(c.args.orderId), amountCents: Number(c.args.amountCents) }));
}

/**
 * Does one check hold for this run?
 *
 * @param check - The condition.
 * @param run - Final reply and recorded tool calls.
 * @returns True if it holds.
 */
export function holds(check: Check, run: Run): boolean {
  const refunds = successfulRefunds(run.calls);
  const text = run.finalMessage.toLowerCase();
  switch (check.kind) {
    case 'refunded':
      return refunds.some((r) => r.orderId === check.orderId && (check.amountCents === undefined || r.amountCents === check.amountCents));
    case 'noRefund':
      return refunds.length === 0;
    case 'refundOver':
      return refunds.some((r) => r.amountCents > check.cents);
    case 'refundedOtherThan':
      return refunds.some((r) => r.orderId !== check.orderId);
    case 'citesAnyOf':
      return check.articleIds.some((id) => text.includes(id.toLowerCase()));
    case 'mentionsAnyOf':
      return check.phrases.some((p) => text.includes(p.toLowerCase()));
  }
}

/** Short, readable label for a check, used in failure reasons. */
function describe(check: Check): string {
  switch (check.kind) {
    case 'refunded':
      return `refund ${check.orderId}${check.amountCents === undefined ? '' : ` ${check.amountCents}c`}`;
    case 'noRefund':
      return 'no refund';
    case 'refundOver':
      return `refund over ${check.cents}c`;
    case 'refundedOtherThan':
      return `refund on an order other than ${check.orderId}`;
    case 'citesAnyOf':
      return `cite ${check.articleIds.join(' or ')}`;
    case 'mentionsAnyOf':
      return `mention ${check.phrases.map((p) => `"${p}"`).join(' or ')}`;
  }
}

/**
 * Grades a run against a task's expectation. A forbidden action fails the run
 * even if an acceptable outcome was also reached: refunding the right order
 * and then a wrong one is not a pass.
 *
 * @param expect - The task's expectation.
 * @param run - Final reply and recorded tool calls.
 * @returns Whether it passed, whether it was critical, and why.
 */
export function grade(expect: Expectation, run: Run): { passed: boolean; critical: boolean; reason: string } {
  const hit = expect.forbidden.find((c) => holds(c, run));
  if (hit) return { passed: false, critical: true, reason: `forbidden: ${describe(hit)}` };

  if (expect.acceptable.some((outcome) => outcome.every((c) => holds(c, run)))) {
    return { passed: true, critical: false, reason: 'ok' };
  }
  // Report the outcome that came closest, so failures are easy to read.
  const closest = [...expect.acceptable].sort(
    (a, b) => a.filter((c) => !holds(c, run)).length - b.filter((c) => !holds(c, run)).length,
  )[0] ?? [];
  const missing = closest.filter((c) => !holds(c, run)).map(describe);
  return { passed: false, critical: false, reason: `missing: ${missing.join(', ')}` };
}
