/**
 * Wraps any retriever so every call is recorded, without changing its results.
 *
 * Purpose: the metering step. Before touching prompts or models, capture what
 * retrieval actually returned for real queries.
 * Dependencies: ./types.ts
 */
import type { Clock, EventSink, RetrievalEvent, RetrievedChunk, Retriever } from './types.ts';

/** Options for {@link instrument}. */
export interface InstrumentOptions {
  sink: EventSink;
  clock: Clock;
  /** Makes a query id. Defaults to a counter, which is enough for one process. */
  nextId?: () => string;
}

/**
 * Returns a retriever that behaves exactly like `retriever` and records each call.
 *
 * A failing sink never breaks retrieval: the audit is diagnostics, and a
 * logging outage must not take the product down with it.
 *
 * @param retriever - The retriever to wrap.
 * @param options - Sink, clock and optional id maker.
 * @returns `retrieve`, with the same results as the original, and
 *   `retrieveExpecting`, which also records the sources a correct answer needs.
 * @throws Whatever `retriever` throws; recording errors are swallowed.
 */
export function instrument(retriever: Retriever, options: InstrumentOptions) {
  let counter = 0;
  const nextId = options.nextId ?? (() => `q${++counter}`);

  async function run(query: string, expectedSourceIds?: string[]): Promise<RetrievedChunk[]> {
    const started = options.clock.now();
    const chunks = await retriever(query);
    const event: RetrievalEvent = {
      queryId: nextId(),
      query,
      at: new Date(started).toISOString(),
      latencyMs: options.clock.now() - started,
      // Copy so later mutation by the caller can't rewrite the record.
      chunks: chunks.map((c) => ({ ...c })),
      ...(expectedSourceIds ? { expectedSourceIds: [...expectedSourceIds] } : {}),
    };
    try {
      await options.sink.write(event);
    } catch {
      // Deliberately ignored: see the function comment.
    }
    return chunks;
  }

  return {
    /** Drop-in replacement for the original retriever. */
    retrieve: (query: string) => run(query),
    /** Same call, also recording the sources a correct answer needs (labelled test sets). */
    retrieveExpecting: (query: string, expectedSourceIds: string[]) => run(query, expectedSourceIds),
  };
}

/** In-memory sink for tests and one-off audits. */
export class MemorySink implements EventSink {
  readonly events: RetrievalEvent[] = [];
  write(event: RetrievalEvent): void {
    this.events.push(event);
  }
}
