/**
 * A fake support agent with tunable mistake rates.
 *
 * STUB: stands in for the real LLM agent so the harness can be run and
 * tested for free. A real adapter implements the same Agent interface: it
 * sends the ticket and tool definitions to the model with the prompt under
 * test, executes the tool calls the model asks for against the sandboxed
 * tools, and returns the final reply and token usage. Because the harness
 * only sees that interface, swapping the stub for the real agent changes
 * nothing else.
 *
 * It is non-deterministic on purpose, like a real model: each run of the same
 * ticket draws new random choices, but from a seeded sequence, so the demo
 * prints the same numbers every time.
 * Dependencies: ../src/types.ts, ./suite.ts
 */
import { InfraError } from '../src/types.ts';
import type { Agent, Tools, Usage } from '../src/types.ts';
import { ESCALATION_CENTS } from './suite.ts';

export interface Knobs {
  /** Chance of citing the wrong help article. */
  wrongArticle: number;
  /** Chance of refunding a large order instead of escalating it. */
  ignoreEscalation: number;
  /** Chance of refunding outside the 30-day window. */
  skipWindowCheck: number;
  /** Chance of offering a replacement for a damaged item instead of a refund. */
  offerReplacement: number;
  /** Chance of a malformed tool call that crashes the run. */
  crash: number;
  /** Chance of a provider outage on a run (retried by the harness). */
  infraFlake: number;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a fake agent.
 *
 * @param version - Version label (part of the harness cache key).
 * @param knobs - Mistake rates for this version.
 * @returns An Agent.
 */
export function fakeAgent(version: string, knobs: Knobs): Agent {
  const runsPerTicket = new Map<string, number>();

  return {
    version,
    async run({ ticket }, tools: Tools) {
      const n = runsPerTicket.get(ticket) ?? 0;
      runsPerTicket.set(ticket, n + 1);
      const rand = seeded(hash(`${version}|${ticket}|${n}`));
      const usage: Usage = { inputTokens: 900 + Math.floor(rand() * 800), outputTokens: 120 + Math.floor(rand() * 160), costUsd: 0 };
      // Sample pricing: $3 per million input tokens, $15 per million output.
      usage.costUsd = usage.inputTokens * 3e-6 + usage.outputTokens * 15e-6;

      if (rand() < knobs.infraFlake) throw new InfraError('provider returned 503');
      if (rand() < knobs.crash) throw new Error('model produced a malformed tool call');

      const orderId = ticket.match(/#(\w+)/)?.[1];
      if (!orderId) {
        const hits = await tools.search_kb(ticket);
        const pick = rand() < knobs.wrongArticle ? hits[1] ?? hits[0] : hits[0];
        return { finalMessage: pick ? `${pick.body} [${pick.id}]` : 'Let me connect you with a person.', usage };
      }

      const order = await tools.lookup_order(orderId);
      if (!order) return { finalMessage: `I couldn't find order ${orderId}.`, usage };

      if (/damaged/i.test(ticket)) {
        if (rand() < knobs.offerReplacement) return { finalMessage: "Sorry about that. We'll ship a replacement today.", usage };
        await tools.issue_refund(order.id, order.totalCents);
        return { finalMessage: 'Sorry about that. I have refunded the full amount.', usage };
      }

      const inWindow = order.status === 'delivered' && (order.deliveredDaysAgo ?? 0) <= 30;
      if (!inWindow && rand() >= knobs.skipWindowCheck) {
        return { finalMessage: 'Returns are accepted within 30 days of delivery, so this order is not eligible. [KB-101]', usage };
      }
      if (order.totalCents > ESCALATION_CENTS && rand() >= knobs.ignoreEscalation) {
        return { finalMessage: "Refunds over $200 go to a specialist; I've escalated this and they'll reply within 2 business days. [KB-105]", usage };
      }
      await tools.issue_refund(order.id, order.totalCents);
      return { finalMessage: 'Done: I have refunded your order in full.', usage };
    },
  };
}
