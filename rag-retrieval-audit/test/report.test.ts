/**
 * Tests for the audit report: each diagnosis (dominant chunk, never-retrieved
 * sources, low confidence, recall misses, latency) and the edge cases.
 * Dependencies: node:test, node:assert, ../src
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, formatReport } from '../src/report.ts';
import type { RetrievalEvent, RetrievedChunk } from '../src/types.ts';

const c = (chunkId: string, score: number): RetrievedChunk => ({
  chunkId,
  sourceId: chunkId.split('#')[0]!,
  score,
});

function event(id: string, chunks: RetrievedChunk[], latencyMs = 10, expected?: string[]): RetrievalEvent {
  return {
    queryId: id,
    query: `query ${id}`,
    at: '2026-11-21T12:00:00.000Z',
    latencyMs,
    chunks,
    ...(expected ? { expectedSourceIds: expected } : {}),
  };
}

const corpus = ['footer', 'policy', 'shelf-life', 'grading'];

const events = [
  event('q1', [c('footer#1', 0.8), c('policy#1', 0.7)], 10, ['policy']),
  event('q2', [c('footer#1', 0.75), c('shelf-life#1', 0.7)], 20, ['shelf-life']),
  event('q3', [c('footer#1', 0.6), c('footer#2', 0.55)], 30, ['grading']),
  event('q4', [c('policy#1', 0.3)], 40),
];

test('finds the chunk that wins most queries', () => {
  const report = buildReport(events, { corpusSourceIds: corpus });
  assert.deepEqual(report.dominantChunk, { chunkId: 'footer#1', share: 0.75 });
});

test('counts a source once per query, at its best rank', () => {
  const report = buildReport(events, { corpusSourceIds: corpus });
  const footer = report.sources.find((s) => s.sourceId === 'footer')!;
  // q3 returns two footer chunks; it still counts as one hit at rank 1.
  assert.deepEqual(footer, { sourceId: 'footer', queriesHit: 3, timesTop1: 3, meanBestRank: 1 });
  const policy = report.sources.find((s) => s.sourceId === 'policy')!;
  assert.deepEqual(policy, { sourceId: 'policy', queriesHit: 2, timesTop1: 1, meanBestRank: 1.5 });
  assert.equal(report.sources[0]!.sourceId, 'footer');
});

test('lists corpus sources that never came back', () => {
  const report = buildReport(events, { corpusSourceIds: corpus });
  assert.deepEqual(report.neverRetrieved, ['grading']);
});

test('flags queries whose best score is under the threshold, and empty results', () => {
  const withEmpty = [...events, event('q5', [])];
  const report = buildReport(withEmpty, { corpusSourceIds: corpus, minTopScore: 0.5 });
  assert.deepEqual(
    report.lowConfidence.map((q) => [q.queryId, q.topScore]),
    [
      ['q4', 0.3],
      ['q5', 0],
    ],
  );
});

test('measures recall at k only over labelled queries', () => {
  const report = buildReport(events, { corpusSourceIds: corpus, k: 2 });
  assert.equal(report.recallAtK!.labelled, 3);
  assert.equal(report.recallAtK!.rate, 2 / 3);
  assert.deepEqual(report.recallAtK!.misses, [
    { queryId: 'q3', query: 'query q3', expected: ['grading'], got: ['footer'] },
  ]);
});

test('recall respects k: the right source at rank 2 misses when k is 1', () => {
  const report = buildReport(events, { corpusSourceIds: corpus, k: 1 });
  assert.equal(report.recallAtK!.rate, 0);
});

test('reports latency percentiles', () => {
  const report = buildReport(events, { corpusSourceIds: corpus });
  assert.equal(report.latencyP50Ms, 20);
  assert.equal(report.latencyP95Ms, 40);
});

test('handles no events', () => {
  const report = buildReport([], { corpusSourceIds: corpus });
  assert.equal(report.queries, 0);
  assert.equal(report.dominantChunk, null);
  assert.equal(report.recallAtK, null);
  assert.deepEqual(report.neverRetrieved, [...corpus].sort());
  assert.equal(report.latencyP95Ms, 0);
});

test('formats a readable summary', () => {
  const text = formatReport(buildReport(events, { corpusSourceIds: corpus, k: 2 }));
  assert.match(text, /Queries: 4/);
  assert.match(text, /Most frequent top-1 chunk: footer#1 \(75% of queries\)/);
  assert.match(text, /Never retrieved: grading/);
  assert.match(text, /Recall@2: 67% of 3 labelled queries/);
  assert.match(text, /miss q3: wanted grading; got footer/);
});
