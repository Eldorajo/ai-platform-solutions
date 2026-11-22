/**
 * Demo: audit a small produce-trading help index with two planted faults.
 *
 *   1. A support footer that mentions orders, prices, deliveries and damage
 *      was indexed as its own chunk, so it outranks real answers.
 *   2. The lettuce grading guide is in the corpus list but failed ingestion.
 *
 * The documents, queries and retriever are sample data written for this demo.
 * The retriever is a word-overlap scorer standing in for a vector search; the
 * audit only sees its output, so it works the same against a real one.
 * Run: npm run demo
 */
import { instrument, MemorySink } from '../src/recorder.ts';
import { buildReport, formatReport } from '../src/report.ts';
import type { Clock, RetrievedChunk } from '../src/types.ts';

const docs: Record<string, string> = {
  'po-change-policy':
    'Changes to a confirmed purchase order need buyer and supplier approval. Quantity changes under 10 percent are accepted automatically. Price changes always need approval.',
  'berry-shelf-life': 'Strawberries keep quality 5 to 7 days at 32 to 34 F. Reject loads that arrive above 40 F.',
  'supplier-onboarding': 'A new supplier uploads food safety certificates and banking details before the first purchase order.',
  'credit-memo-process': 'Request a credit memo within 48 hours of delivery when product arrives damaged or short.',
  'support-footer':
    'Questions about an order, product, delivery, price change or supplier? If something arrived damaged or short, contact support.',
};
// In the corpus but missing from the index: the ingestion job skipped it.
const corpusSourceIds = [...Object.keys(docs), 'lettuce-grading'];

const stopwords = new Set('a an the to of or and is are be do does how i my what who on for at in can that before after any'.split(' '));
const words = (text: string) =>
  new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !stopwords.has(w)));

/** Share of the query's words found in the chunk, top 3 results. */
async function retriever(query: string): Promise<RetrievedChunk[]> {
  const q = words(query);
  return Object.entries(docs)
    .map(([sourceId, text]) => {
      const d = words(text);
      const shared = [...q].filter((w) => d.has(w)).length;
      return { chunkId: `${sourceId}#1`, sourceId, score: Math.round((shared / Math.max(q.size, 1)) * 100) / 100 };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
    .slice(0, 3);
}

// Fixed clock so the printed latencies are the same on every run.
let t = Date.UTC(2026, 10, 21, 12, 0, 0);
const clock: Clock = { now: () => (t += 40) };

const sink = new MemorySink();
const audited = instrument(retriever, { sink, clock });

const labelled: [string, string][] = [
  ['Can I change the quantity on a confirmed purchase order?', 'po-change-policy'],
  ['Who approves a price change on an order?', 'po-change-policy'],
  ['How many days do strawberries keep?', 'berry-shelf-life'],
  ['What does a new supplier upload first?', 'supplier-onboarding'],
  ['Product arrived damaged, how do I get a credit?', 'credit-memo-process'],
  ['Delivery arrived short, what now?', 'credit-memo-process'],
  ['What is the tip burn tolerance for romaine?', 'lettuce-grading'],
];

for (const [query, expected] of labelled) {
  await audited.retrieveExpecting(query, [expected]);
}

console.log(formatReport(buildReport(sink.events, { corpusSourceIds, k: 1, minTopScore: 0.5 })));
