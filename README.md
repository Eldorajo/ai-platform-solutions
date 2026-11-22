# AI platform solutions

Three scenarios that come up when you run AI features in production, and how I'd solve each one: deciding whether an agent change is safe to ship, keeping AI working on customer networks that block it, and finding out why retrieval-backed answers go wrong.

Each one is written as "if this were the issue, this is how I'd solve it": the reasoning first, then working TypeScript with tests, then the caveats and security concerns. The code was built with AI assistance under the process in [`docs/SDLC.md`](docs/SDLC.md).

| Package | Scenario | Tests |
| --- | --- | --- |
| [`agent-eval-harness`](agent-eval-harness) | Decide whether a prompt or model change to a tool-using support agent ships, given non-deterministic outputs, several valid answers per task, and a budget | 26 |
| [`vpn-path-switcher`](vpn-path-switcher) | Keep AI features working when a customer's VPN or firewall blocks them, and know what to try when the first fix doesn't work | 10 |
| [`rag-retrieval-audit`](rag-retrieval-audit) | Find out whether wrong answers come from retrieval, before touching prompts or models | 15 |

## Docs

- [`docs/WALKTHROUGHS.md`](docs/WALKTHROUGHS.md): how I'd reason through each scenario, step by step
- [`docs/AGENT_DESIGN.md`](docs/AGENT_DESIGN.md): how I'd build the support agent itself
- [`docs/SDLC.md`](docs/SDLC.md): how I build with AI assistance and keep it trustworthy
- [`docs/SECURITY.md`](docs/SECURITY.md): security concerns for each solution

## Run it

Needs Node 22.18 or later, which runs TypeScript directly. No runtime dependencies.

```
npm install
npm test            # all 51 tests
npm run typecheck
npm run demo -w agent-eval-harness
npm run demo -w rag-retrieval-audit
```

Open `vpn-path-switcher/sim/index.html` in a browser for the interactive failover simulation.

## What's real and what's sample

The harness, switcher and audit are complete, tested code. The data they run on in the demos is sample data written for this repo: the 100 support tasks, the fake agent with tunable mistake rates, the small help index, and the policy rules (30-day returns, $200 escalation). Each package's README says exactly what's stubbed and why.
