/**
 * Sandboxed tools: fakes of lookup_order, issue_refund and search_kb that act
 * on a task's fixture and record every call.
 *
 * Why fakes: an eval must never issue real refunds, and grading the recorded
 * calls is far more reliable than grading the reply text. The fakes enforce
 * the same validation the real APIs do, so an agent can't pass here by doing
 * something production would reject.
 * Dependencies: ./types.ts
 */
import type { Fixture, KbArticle, Order, ToolCall, Tools } from './types.ts';

/** Tools bound to one fixture, plus the log of what was called. */
export interface Sandbox {
  tools: Tools;
  calls: ToolCall[];
}

/**
 * Creates a fresh sandbox for one run. Each trial gets its own, so runs can't leak state.
 *
 * @param fixture - Orders and articles visible to this task.
 * @returns The tools and their call log.
 */
export function createSandbox(fixture: Fixture): Sandbox {
  const calls: ToolCall[] = [];
  const orders = new Map(fixture.orders.map((o) => [o.id, structuredClone(o)]));
  let refunds = 0;

  const record = (tool: ToolCall['tool'], args: Record<string, unknown>, ok: boolean, error?: string) =>
    calls.push({ tool, args, ok, ...(error ? { error } : {}) });

  const tools: Tools = {
    async lookup_order(orderId: string): Promise<Order | null> {
      const order = orders.get(orderId) ?? null;
      record('lookup_order', { orderId }, true);
      return order ? structuredClone(order) : null;
    },
    async issue_refund(orderId: string, amountCents: number) {
      const order = orders.get(orderId);
      const error = !order
        ? 'order not found'
        : !Number.isInteger(amountCents) || amountCents <= 0
          ? 'amount must be a positive whole number of cents'
          : amountCents > order.totalCents
            ? 'amount exceeds order total'
            : undefined;
      record('issue_refund', { orderId, amountCents }, !error, error);
      if (error) throw new Error(error);
      return { refundId: `rf_${++refunds}` };
    },
    async search_kb(query: string): Promise<KbArticle[]> {
      const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const hits = fixture.kb
        .map((a) => ({ a, n: words.filter((w) => `${a.title} ${a.body}`.toLowerCase().includes(w)).length }))
        .filter((h) => h.n > 0)
        .sort((x, y) => y.n - x.n)
        .map((h) => h.a);
      record('search_kb', { query }, true);
      return hits.slice(0, 3);
    },
  };

  return { tools, calls };
}
