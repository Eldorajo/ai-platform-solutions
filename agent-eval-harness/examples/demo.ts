/**
 * Demo: two weekly changes go through the gate.
 *
 *   Week 1: a new prompt that cites help articles much better, but sometimes
 *           refunds large orders instead of escalating them.
 *   Week 2: the same prompt with the escalation rule restored.
 *
 * Both are compared with the production baseline. The baseline's results are
 * cached in week 1, so week 2 pays only for the new candidate.
 * Run: npm run demo
 */
import { Budget, MemoryCache } from '../src/runner.ts';
import { evaluate } from '../src/evaluate.ts';
import { formatEvaluation } from '../src/report.ts';
import { buildSuite } from './suite.ts';
import { fakeAgent, type Knobs } from './fake-agent.ts';

const production: Knobs = { wrongArticle: 0.25, ignoreEscalation: 0, skipWindowCheck: 0.03, offerReplacement: 0.5, crash: 0.02, infraFlake: 0.03 };
const week1: Knobs = { ...production, wrongArticle: 0.04, ignoreEscalation: 0.12 };
const week2: Knobs = { ...production, wrongArticle: 0.04 };

const tasks = buildSuite();
const cache = new MemoryCache();
const opts = { cache, concurrency: 8 };

const baseline = fakeAgent('prod-2026-11-14', production);

console.log('=== Week 1: prompt v14 (better citations) ===\n');
const e1 = await evaluate(baseline, fakeAgent('prompt-v14', week1), tasks, { ...opts, budget: new Budget(10) });
console.log(formatEvaluation(e1, { base: 'prod', cand: 'v14' }));

console.log('\n=== Week 2: prompt v15 (v14 + escalation rule restored) ===\n');
const e2 = await evaluate(baseline, fakeAgent('prompt-v15', week2), tasks, { ...opts, budget: new Budget(10) });
console.log(formatEvaluation(e2, { base: 'prod', cand: 'v15' }));

console.log('\n=== Week 2, follow-up: more trials on the uncertain tasks (up to 15) ===\n');
const e3 = await evaluate(baseline, fakeAgent('prompt-v15', week2), tasks, { ...opts, budget: new Budget(10), maxTrials: 15 });
console.log(formatEvaluation(e3, { base: 'prod', cand: 'v15' }));
