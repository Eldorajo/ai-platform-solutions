/**
 * A sample suite of 100 tasks in five categories, generated from templates.
 *
 * STUB: in real use the suite comes from production tickets, labelled by the
 * support team with every acceptable outcome, and grows each time a bad answer
 * reaches a customer. These generated tasks exist to exercise the harness.
 * The policy they encode (30-day window, specialist review over $200) is sample policy.
 * Dependencies: ../src/types.ts
 */
import type { KbArticle, Order, Task } from '../src/types.ts';

export const KB: KbArticle[] = [
  { id: 'KB-101', title: 'Return window', body: 'Items can be returned within 30 days of delivery for a full refund.' },
  { id: 'KB-102', title: 'Damaged items', body: 'If an item arrives damaged we offer a replacement or a full refund.' },
  { id: 'KB-103', title: 'Change shipping address', body: 'You can change the shipping address while an order is still processing.' },
  { id: 'KB-104', title: 'Track your order', body: 'Track a shipped package from Orders, then Track package.' },
  { id: 'KB-105', title: 'Large refunds', body: 'Refunds over $200 are reviewed by a specialist within 2 business days.' },
  { id: 'KB-106', title: 'Cancel an order', body: 'Cancel an order while it is still processing from Orders, then Cancel.' },
];

/** Refunds above this go to a specialist instead of the agent. */
export const ESCALATION_CENTS = 20_000;

const howTo: { q: string; valid: string[] }[] = [
  { q: 'How do I track my package?', valid: ['KB-104'] },
  { q: 'Can I change the shipping address on my order?', valid: ['KB-103'] },
  // Two valid answers: changing the address or cancelling both solve this.
  { q: 'I typed the wrong address, can I change it or cancel the order?', valid: ['KB-103', 'KB-106'] },
  { q: 'How long do I have to return something?', valid: ['KB-101'] },
  { q: 'How do I cancel an order that is still processing?', valid: ['KB-106'] },
];

/**
 * Builds the 100-task suite. Deterministic: the same suite every run.
 *
 * @returns The tasks.
 */
export function buildSuite(): Task[] {
  const tasks: Task[] = [];
  for (let i = 0; i < 20; i++) {
    const customerId = `C${200 + i}`;
    // Each customer has a second order, so refunding the wrong one is possible and detectable.
    const other: Order = { id: `B${5000 + i}`, customerId, totalCents: 2_500 + i * 100, status: 'delivered', deliveredDaysAgo: 3 };

    const small = 1_999 + i * 650; // $19.99 to $143.49, under the escalation limit
    const eligible: Order = { id: `A${1000 + i}`, customerId, totalCents: small, status: 'delivered', deliveredDaysAgo: 2 + (i % 25) };
    tasks.push({
      id: `refund-ok-${i}`,
      category: 'refund eligible',
      ticket: `Hi, I'd like a refund for order #${eligible.id}. It isn't what I expected.`,
      customerId,
      fixture: { orders: [eligible, other], kb: KB },
      expect: {
        acceptable: [[{ kind: 'refunded', orderId: eligible.id, amountCents: small }]],
        forbidden: [{ kind: 'refundedOtherThan', orderId: eligible.id }],
      },
    });

    const late: Order = { id: `A${2000 + i}`, customerId, totalCents: small, status: 'delivered', deliveredDaysAgo: 31 + i * 3 };
    tasks.push({
      id: `refund-late-${i}`,
      category: 'refund past window',
      ticket: `Please refund order #${late.id}, I don't need it anymore.`,
      customerId,
      fixture: { orders: [late, other], kb: KB },
      expect: {
        acceptable: [[{ kind: 'noRefund' }, { kind: 'mentionsAnyOf', phrases: ['30 days', '30-day'] }]],
        forbidden: [{ kind: 'refunded', orderId: late.id }, { kind: 'refundedOtherThan', orderId: late.id }],
      },
    });

    const big: Order = { id: `A${3000 + i}`, customerId, totalCents: ESCALATION_CENTS + 1_000 + i * 2_500, status: 'delivered', deliveredDaysAgo: 5 };
    tasks.push({
      id: `refund-large-${i}`,
      category: 'refund over $200',
      ticket: `I want my money back for order #${big.id}, it stopped working.`,
      customerId,
      fixture: { orders: [big, other], kb: KB },
      expect: {
        acceptable: [[{ kind: 'noRefund' }, { kind: 'mentionsAnyOf', phrases: ['specialist', 'escalat'] }]],
        forbidden: [{ kind: 'refundOver', cents: ESCALATION_CENTS }, { kind: 'refundedOtherThan', orderId: big.id }],
      },
    });

    const damaged: Order = { id: `A${4000 + i}`, customerId, totalCents: small, status: 'delivered', deliveredDaysAgo: 1 };
    tasks.push({
      id: `damaged-${i}`,
      category: 'damaged item',
      ticket: `Order #${damaged.id} arrived damaged. What can you do?`,
      customerId,
      fixture: { orders: [damaged, other], kb: KB },
      expect: {
        // Two valid answers: a full refund, or a replacement with no refund.
        acceptable: [
          [{ kind: 'refunded', orderId: damaged.id, amountCents: small }],
          [{ kind: 'noRefund' }, { kind: 'mentionsAnyOf', phrases: ['replacement'] }],
        ],
        forbidden: [{ kind: 'refundedOtherThan', orderId: damaged.id }],
      },
    });

    const h = howTo[i % howTo.length]!;
    tasks.push({
      id: `how-to-${i}`,
      category: 'how-to question',
      ticket: h.q,
      customerId,
      fixture: { orders: [other], kb: KB },
      expect: {
        acceptable: [[{ kind: 'citesAnyOf', articleIds: h.valid }, { kind: 'noRefund' }]],
        forbidden: [{ kind: 'refundOver', cents: 0 }],
      },
    });
  }
  return tasks;
}
