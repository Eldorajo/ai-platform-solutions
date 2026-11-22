/**
 * Tests for the recording wrapper: results pass through unchanged, each call is
 * recorded with metered latency, and recording failures never break retrieval.
 * Dependencies: node:test, node:assert, ../src
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instrument, MemorySink } from '../src/recorder.ts';
import type { Clock, RetrievedChunk } from '../src/types.ts';

/** Clock that advances 25 ms on every read, so latency is always 25. */
function steppingClock(start = Date.UTC(2026, 10, 21, 12, 0, 0)): Clock {
  let t = start - 25;
  return { now: () => (t += 25) };
}

const chunks: RetrievedChunk[] = [
  { chunkId: 'a#1', sourceId: 'a', score: 0.9 },
  { chunkId: 'b#1', sourceId: 'b', score: 0.4 },
];

test('passes results through and records the call', async () => {
  const sink = new MemorySink();
  const audited = instrument(async () => chunks, { sink, clock: steppingClock() });

  const result = await audited.retrieve('where is my order');

  assert.deepEqual(result, chunks);
  assert.equal(sink.events.length, 1);
  const [event] = sink.events;
  assert.equal(event!.queryId, 'q1');
  assert.equal(event!.query, 'where is my order');
  assert.equal(event!.at, '2026-11-21T12:00:00.000Z');
  assert.equal(event!.latencyMs, 25);
  assert.deepEqual(event!.chunks, chunks);
  assert.equal(event!.expectedSourceIds, undefined);
});

test('records expected sources for labelled queries', async () => {
  const sink = new MemorySink();
  const audited = instrument(async () => chunks, { sink, clock: steppingClock() });

  await audited.retrieveExpecting('q', ['a']);

  assert.deepEqual(sink.events[0]!.expectedSourceIds, ['a']);
});

test('the record is a copy, so later changes to results do not rewrite history', async () => {
  const sink = new MemorySink();
  const audited = instrument(async () => chunks.map((c) => ({ ...c })), { sink, clock: steppingClock() });

  const result = await audited.retrieve('q');
  result[0]!.score = 0;

  assert.equal(sink.events[0]!.chunks[0]!.score, 0.9);
});

test('a failing sink does not break retrieval', async () => {
  const audited = instrument(async () => chunks, {
    sink: { write: () => Promise.reject(new Error('log store down')) },
    clock: steppingClock(),
  });

  assert.deepEqual(await audited.retrieve('q'), chunks);
});

test('a failing retriever still throws, and nothing is recorded', async () => {
  const sink = new MemorySink();
  const audited = instrument(
    async () => {
      throw new Error('index offline');
    },
    { sink, clock: steppingClock() },
  );

  await assert.rejects(audited.retrieve('q'), /index offline/);
  assert.equal(sink.events.length, 0);
});

test('uses a custom id maker when given', async () => {
  const sink = new MemorySink();
  const audited = instrument(async () => chunks, { sink, clock: steppingClock(), nextId: () => 'fixed' });

  await audited.retrieve('q');

  assert.equal(sink.events[0]!.queryId, 'fixed');
});
