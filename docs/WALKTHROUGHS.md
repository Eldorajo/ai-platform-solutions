# Walkthroughs

How I'd reason through each scenario, start to finish: the goal, the first question I'd ask, my assumptions, then the steps. The code in this repo is the worked-out version.

## Evaluating a tool-using support agent

**Scenario:** a support agent with `lookup_order`, `issue_refund` and `search_kb`; prompt and model changes every week; no reliable way to tell if a change helped. Evaluate it on 100 tasks, given non-deterministic outputs, tasks with several valid answers, runs that cost money, and a result that decides whether a change ships.

**First question:** "This harness decides whether a change ships, so I'm optimizing for a decision we can trust, not a score. Is 'resolved' about the right action, like the right refund, or reply quality too? I'll assume both, with actions weighted most."

1. **Grade outcomes, not text.** Run against sandboxed fakes of the three tools, each task with its own small world of orders and articles, recording every call. Grade what happened: right order refunded, right amount. No real refunds in a test.
2. **Several valid answers.** Each task lists acceptable outcomes (any one passes) and forbidden actions (any one fails the run, even if the right thing also happened). A damaged item can pass with a refund or a replacement.
3. **Non-determinism.** Several runs per task and use the pass rate, at production settings. Compare versions on the same tasks, task by task, with a confidence interval on the difference. Track how many tasks pass every time.
4. **Cost.** Cache by version, task and trial, so the baseline is paid for once. Three runs first; more only where results are mixed or the versions disagree. A hard budget. Provider outages retried, not counted against the agent.
5. **The gate.** Block if forbidden actions clearly rise, if the pass rate clearly falls, or if any category clearly drops. Inconclusive if a rise in forbidden actions can't be ruled out. Ship if it's at worst slightly worse. Otherwise inconclusive: more data.
6. **What I'd stub, and why:** the agent adapter (same interface, plugs in later), an LLM judge (needs checking against human ratings first), the task source (real labelled tickets), storage.
7. **What goes wrong:** a zero-tolerance rule per task blocks good changes by chance, so compare forbidden-action rates and review every case by hand. Rerunning until it ships is just rolling the dice. Tuning against the same 100 tasks overfits, so keep a held-out set. Graders have bugs, so review samples by hand.

Code: [`agent-eval-harness`](../agent-eval-harness).

## AI tools failing behind a customer's VPN

**Scenario:** AI features stop working for customers whose VPN, proxy or firewall blocks the calls.

**First question:** "What exactly is blocked: the AI provider's domain, streaming connections, or everything outbound? And is it deliberate?"

1. **Principle:** design for the environment, don't fight it.
2. **Diagnose the layer first:** DNS, connection, TLS inspection, a proxy's category block, streaming limits, size limits. Each has a different fix.
3. **First fix:** route AI calls through our own domain, a gateway the client already reaches.
4. **Fallback:** store-and-forward. The client writes a job, a worker calls the model, the client polls. Detect the block with a short timeout, switch automatically, retry the same request, probe and switch back when it clears.
5. **If that had already been tried:** shorter polling or long polling for speed; plain requests if streaming broke; published domains and IP ranges for allowlisting; private connectivity; deployment inside the customer's own cloud; and a product that still works without AI.
6. **If the block is deliberate:** it's a conversation with the customer's security team, not a workaround.
7. **How I'd know it works:** log which path each request used and its latency, and alert when a customer is stuck on the fallback.

Code: [`vpn-path-switcher`](../vpn-path-switcher), including an interactive simulation.

## Debugging wrong answers from retrieval

**Scenario:** a retrieval-backed assistant gives wrong answers.

**First question:** "Before changing the prompt or the model, I want to see what retrieval actually returned."

1. Record every retrieval: query, ranked chunks, scores, latency.
2. Report four things: a chunk that wins everything (often boilerplate), documents never retrieved (ingestion gaps), queries with low scores (the answer isn't in the index), and recall on labelled queries.
3. Fix the cause it points to. Usually that's chunking or ingestion, not the model.

Code: [`rag-retrieval-audit`](../rag-retrieval-audit).
