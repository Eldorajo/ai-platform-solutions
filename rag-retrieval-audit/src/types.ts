/**
 * Shared types for the retrieval audit.
 *
 * Purpose: describe one retrieval call (what was asked, what came back, how
 * long it took) so the report can work out why answers go wrong.
 * Dependencies: none.
 */

/** One chunk the retriever returned for a query. */
export interface RetrievedChunk {
  /** Stable id of the chunk inside the index. */
  chunkId: string;
  /** Id of the document the chunk came from. Reports group by this. */
  sourceId: string;
  /** Similarity score from the retriever. Higher is better. */
  score: number;
}

/** Everything recorded about one retrieval call. */
export interface RetrievalEvent {
  queryId: string;
  query: string;
  /** ISO time the call started, from the injected clock. */
  at: string;
  /** Wall time of the call in milliseconds. */
  latencyMs: number;
  /** Chunks in the order the retriever ranked them (index 0 = rank 1). */
  chunks: RetrievedChunk[];
  /**
   * Sources a correct answer needs, when known (from a labelled test set or
   * a user's thumbs-down review). Optional: most live traffic has none.
   */
  expectedSourceIds?: string[];
}

/** A retriever: query text in, ranked chunks out. */
export type Retriever = (query: string) => Promise<RetrievedChunk[]>;

/** Where recorded events go: memory in tests, a table or log in production. */
export interface EventSink {
  write(event: RetrievalEvent): void | Promise<void>;
}

/** Time source, injected so tests are deterministic. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}
