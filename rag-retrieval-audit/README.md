# rag-retrieval-audit

**Scenario:** a retrieval-backed assistant gives wrong answers, and the first instinct is to change the prompt or the model.

**If this were the issue, this is how I'd solve it:** first find out what retrieval actually returned, because the cause is usually there. This tool records every retrieval for real queries, then reports where it's going wrong.

## How it works

1. **Record.** `instrument()` wraps any retriever. Results are unchanged; every call is logged with its query, ranked chunks, scores and latency. If the log store fails, retrieval keeps working.
2. **Report.** `buildReport()` reads the log and answers four questions:

| Question | Report field | Usual cause | Usual fix |
| --- | --- | --- | --- |
| Is one chunk winning everything? | `dominantChunk`, source table | Boilerplate (footers, disclaimers) indexed as content | Strip boilerplate before chunking |
| Are some documents never retrieved? | `neverRetrieved` | Ingestion failed or chunking broke the document | Fix the pipeline, re-index, add an ingestion check |
| Are scores too low to trust? | `lowConfidence` | The answer isn't in the index | Add the content, or have the AI say "I don't know" |
| When we know the right source, does it come back? | `recallAtK` | Ranking, chunk size, or embedding model | Tune chunking, add reranking, compare models on this set |

Recall needs labelled queries: a question plus the source that should answer it. Build that set from real thumbs-down answers, and rerun it before every change ships.

## Run it

Needs Node 22.18 or later (runs TypeScript directly).

```
npm install
npm test          # 15 tests
npm run typecheck
npm run demo
```

## The demo

A small produce-trading help index with two faults planted in it. All of the documents and queries are sample data.

```
Source                     hit  top-1  mean rank
support-footer               5      2       2.00
...
Never retrieved: lettuce-grading
Recall@1: 57% of 7 labelled queries
  miss q2: wanted po-change-policy; got support-footer
  miss q6: wanted credit-memo-process; got support-footer
  miss q7: wanted lettuce-grading; got nothing
```

Reading it: the support footer shows up in 5 of 7 queries and causes two of the three misses, so strip it before indexing. The third miss comes from the lettuce guide never reaching the index, so check ingestion. Neither fix touches the prompt or the model.

## Using it in production

Replace `MemorySink` with a sink that writes to a table or your log pipeline. Swap the demo's clock for `{ now: Date.now }`. Then run `buildReport` on a day of traffic.

## Caveats

- **It finds where retrieval fails, not whether answers are right.** A query can retrieve the right source and still get a wrong answer from the model. Pair this with an answer-level evaluation (see `agent-eval-harness`).
- **Recall needs labels.** Without labelled queries you get dominance, gaps and low scores, but not recall. Start with 30 to 50 labelled queries from real complaints.
- **Thresholds are per model.** Similarity scores aren't comparable across embedding models. The 0.5 low-confidence threshold is a starting point; set it from your own score distribution.
- **"Never retrieved" can be fine.** A document may simply never be relevant to real traffic. Treat it as a question to check, not a bug.
- **A dominant chunk can be legitimate.** A genuinely central policy page will win often. It's a problem when it wins queries it doesn't answer, which is what recall misses show.
- **The demo retriever is a stand-in.** It scores by word overlap so the demo needs no model. The audit only sees the retriever's output, so it works the same with a real vector search.

## Security

- **The log holds user queries, and queries contain personal data.** Redact names, emails, account and order numbers before writing, or store a hash of the query alongside a redacted version.
- **Keep chunk text out of the log.** It records chunk and source ids, not content, so the log doesn't become a second copy of the knowledge base with weaker access controls.
- **Access and retention.** Limit who can read the log, and delete it on a schedule (30 days is a reasonable default for diagnostics).
- **Tenant isolation.** In a multi-tenant system, record the tenant id on every event and build reports per tenant. One customer's queries must never show up in another customer's report.
- **Recording must not change behavior.** The wrapper returns the retriever's results unchanged and swallows logging failures, so a logging outage can't take retrieval down or change what users see.

## Layout

```
src/types.ts      shapes of a retrieval call and its record
src/recorder.ts   instrument(): the recording wrapper
src/report.ts     buildReport() and formatReport()
test/             unit tests
examples/demo.ts  the demo above
```
