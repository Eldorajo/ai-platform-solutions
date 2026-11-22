# How I build: SDLC for AI-assisted work

I build with AI assistance every day. The question I care about isn't whether to use AI, it's how to keep the result trustworthy, reviewable and safe when much of the first draft comes from a model. This is the process I follow, and how each part of it shows up in this repo.

## 1. Intent before code

Before any prompt or code, I write down what the system is for, what data it can see, what it may do, what it must never do, and what a good outcome looks like. This is the core of my method, Forward: capture intent first, then build the spec, guardrails, design system and context from it. The exhaustive plan is what makes the build fast and keeps it from drifting.

*In this repo:* each package's README starts with the problem and the principle before the code. The agent design starts with the agent's intent (`docs/AGENT_DESIGN.md`).

## 2. Phased builds with gates

I break work into ordered phases, data first and UI last. Each phase has a verification step that must pass before the next starts, explicit "do not" boundaries, and the context the next phase needs carried forward. AI never gets one giant open-ended prompt.

*Example:* on a recent build sharing a database with another live application, the rules were: create objects only in the new app's own schemas, never touch anything else, show every migration's SQL and wait for approval before applying it, and run a guard script first.

## 3. AI drafts, I decide

AI writes first drafts of code, tests and docs. I own the decisions, review what comes back, and can explain every line. When I use an AI agent to build, I have it keep a log of the process and the tasks it carried out, as separate records, and the log is part of the deliverable. That makes the work reviewable by someone who wasn't there.

## 4. Requirements you can trace

Requirements get IDs. Tests are tagged with the requirement they prove. A generated traceability report shows any requirement without a test, and a story isn't done while one is missing. Decisions between real alternatives get a short decision record.

## 5. Tests and evaluations are the gate

- **Deterministic code gets unit tests.** Every package here ships with them: 51 tests across the repo, run in CI on every push.
- **AI behavior gets evaluations.** Prompt and model changes are code changes and go through a gate that decides ship, block or inconclusive (`agent-eval-harness`). A change that "feels better" doesn't ship on feel.
- **Time is injected.** Code takes a clock instead of reading the system time, so tests are repeatable.

## 6. Security is part of the design

- **AI never acts alone.** The model proposes; code enforces the rules; a person approves anything risky.
- **Outside text is untrusted.** Customer text is redacted before any model call, fenced in prompts, and the output is validated.
- **Tenant isolation is enforced twice:** in the API and in the database.
- **Secrets never live in code.** An example env file lists every variable; real values live in a secret store.
- **Shared infrastructure is guarded.** Nothing outside the project's own space changes without a written plan and an explicit approval.

`docs/SECURITY.md` covers the security concerns for each solution in this repo.

## 7. Release in stages

Shadow mode first (the new version runs alongside, without acting), then a small share of traffic, watching the metrics that matter, with rollback ready. For AI changes, the evaluation gate runs before any of this.

## 8. Every failure becomes a test

When something breaks in production, the fix includes a test that would have caught it: a unit test for code, a new task in the evaluation suite for AI behavior. The suite gets stronger every time something goes wrong.

## 9. Docs ship with the code

An API change updates the API reference in the same pull request. A new failure mode gets a runbook entry. Code comments explain *why*: the reason for a limit, an ordering, a security check, an error that's deliberately ignored. The pull request template in `.github/` asks for the evidence: tests, docs, security notes and how the change was verified.
