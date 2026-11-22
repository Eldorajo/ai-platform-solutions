/**
 * Turns recorded retrieval events into a diagnosis.
 *
 * Purpose: answer the four questions that locate most RAG failures:
 *   1. Is one chunk winning everything? (a boilerplate chunk crowding out answers)
 *   2. Are some documents never retrieved? (ingestion or chunking gaps)
 *   3. Are scores too low to trust? (the answer isn't in the index)
 *   4. When we know the right source, did it come back? (recall at k)
 * Dependencies: ./types.ts
 */
import type { RetrievalEvent } from './types.ts';

export interface SourceStat {
  sourceId: string;
  /** Queries where this source appeared anywhere in the results. */
  queriesHit: number;
  /** Queries where this source was ranked first. */
  timesTop1: number;
  /** Average best rank when it appears (1 = top). */
  meanBestRank: number;
}

export interface RecallMiss {
  queryId: string;
  query: string;
  expected: string[];
  got: string[];
}

export interface AuditReport {
  queries: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  /** Sorted by queriesHit, most first. */
  sources: SourceStat[];
  /** The chunk ranked first most often, and its share of all queries (0..1). */
  dominantChunk: { chunkId: string; share: number } | null;
  /** Corpus sources that never appeared in any result. */
  neverRetrieved: string[];
  /** Queries whose best score was below the threshold. */
  lowConfidence: { queryId: string; query: string; topScore: number }[];
  /** Recall at k over the events that carry expected sources; null if none do. */
  recallAtK: { k: number; labelled: number; rate: number; misses: RecallMiss[] } | null;
}

export interface ReportOptions {
  /** Every source in the index, so gaps can be found. */
  corpusSourceIds: string[];
  /** How many top results count for recall. 5 matches a typical context window budget. */
  k?: number;
  /** Below this top score a query is flagged. 0.5 is a starting point; tune per embedding model. */
  minTopScore?: number;
}

/** Nearest-rank percentile; enough precision for a diagnostic report. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)]!;
}

/**
 * Builds the audit report.
 *
 * @param events - Recorded retrieval events.
 * @param options - Corpus list and thresholds.
 * @returns The report; empty input gives zeros and empty lists.
 */
export function buildReport(events: RetrievalEvent[], options: ReportOptions): AuditReport {
  const k = options.k ?? 5;
  const minTopScore = options.minTopScore ?? 0.5;

  const bySource = new Map<string, { hits: number; top1: number; rankSum: number }>();
  const top1Chunks = new Map<string, number>();
  const lowConfidence: AuditReport['lowConfidence'] = [];

  for (const event of events) {
    const first = event.chunks[0];
    if (first) top1Chunks.set(first.chunkId, (top1Chunks.get(first.chunkId) ?? 0) + 1);
    if (!first || first.score < minTopScore) {
      lowConfidence.push({ queryId: event.queryId, query: event.query, topScore: first?.score ?? 0 });
    }

    // Count each source once per query, at its best rank, so a document
    // split into many chunks doesn't look more popular than it is.
    const bestRank = new Map<string, number>();
    event.chunks.forEach((chunk, i) => {
      if (!bestRank.has(chunk.sourceId)) bestRank.set(chunk.sourceId, i + 1);
    });
    for (const [sourceId, rank] of bestRank) {
      const stat = bySource.get(sourceId) ?? { hits: 0, top1: 0, rankSum: 0 };
      stat.hits += 1;
      stat.rankSum += rank;
      if (rank === 1) stat.top1 += 1;
      bySource.set(sourceId, stat);
    }
  }

  const sources: SourceStat[] = [...bySource]
    .map(([sourceId, s]) => ({
      sourceId,
      queriesHit: s.hits,
      timesTop1: s.top1,
      meanBestRank: Math.round((s.rankSum / s.hits) * 100) / 100,
    }))
    .sort((a, b) => b.queriesHit - a.queriesHit || a.sourceId.localeCompare(b.sourceId));

  let dominantChunk: AuditReport['dominantChunk'] = null;
  for (const [chunkId, count] of top1Chunks) {
    if (!dominantChunk || count > dominantChunk.share) dominantChunk = { chunkId, share: count };
  }
  if (dominantChunk) dominantChunk.share = dominantChunk.share / events.length;

  const labelled = events.filter((e) => e.expectedSourceIds && e.expectedSourceIds.length > 0);
  const misses: RecallMiss[] = [];
  for (const event of labelled) {
    const got = [...new Set(event.chunks.slice(0, k).map((c) => c.sourceId))];
    if (!event.expectedSourceIds!.some((id) => got.includes(id))) {
      misses.push({ queryId: event.queryId, query: event.query, expected: event.expectedSourceIds!, got });
    }
  }

  const latencies = events.map((e) => e.latencyMs).sort((a, b) => a - b);

  return {
    queries: events.length,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    sources,
    dominantChunk,
    neverRetrieved: options.corpusSourceIds.filter((id) => !bySource.has(id)).sort(),
    lowConfidence,
    recallAtK:
      labelled.length === 0
        ? null
        : { k, labelled: labelled.length, rate: (labelled.length - misses.length) / labelled.length, misses },
  };
}

/**
 * Renders the report as plain text for a terminal or a ticket.
 *
 * @param report - Output of {@link buildReport}.
 * @returns Multi-line text.
 */
export function formatReport(report: AuditReport): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = [
    `Queries: ${report.queries}   latency p50 ${report.latencyP50Ms} ms, p95 ${report.latencyP95Ms} ms`,
    '',
    'Source                     hit  top-1  mean rank',
    ...report.sources.map(
      (s) =>
        `${s.sourceId.padEnd(26)} ${String(s.queriesHit).padStart(3)}  ${String(s.timesTop1).padStart(5)}  ${s.meanBestRank.toFixed(2).padStart(9)}`,
    ),
    '',
    report.dominantChunk
      ? `Most frequent top-1 chunk: ${report.dominantChunk.chunkId} (${pct(report.dominantChunk.share)} of queries)`
      : 'Most frequent top-1 chunk: none',
    `Never retrieved: ${report.neverRetrieved.length ? report.neverRetrieved.join(', ') : 'none'}`,
    `Low-confidence queries: ${report.lowConfidence.length}`,
    ...report.lowConfidence.map((q) => `  ${q.queryId} (top score ${q.topScore.toFixed(2)}): ${q.query}`),
  ];
  if (report.recallAtK) {
    const r = report.recallAtK;
    lines.push(`Recall@${r.k}: ${pct(r.rate)} of ${r.labelled} labelled queries`);
    for (const m of r.misses) {
      lines.push(`  miss ${m.queryId}: wanted ${m.expected.join(', ')}; got ${m.got.join(', ') || 'nothing'}`);
    }
  }
  return lines.join('\n');
}
