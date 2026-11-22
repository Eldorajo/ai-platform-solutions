/**
 * Renders an evaluation as plain text for a pull request comment or a release ticket.
 * Dependencies: ./evaluate.ts
 */
import type { Evaluation } from './evaluate.ts';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pts = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

/**
 * Formats the result: the decision first, then the evidence.
 *
 * @param e - Output of evaluate().
 * @param labels - Names for the two versions.
 * @returns Multi-line text.
 */
export function formatEvaluation(e: Evaluation, labels: { base: string; cand: string }): string {
  const trials = [...e.trialsPerTask.values()];
  const lines = [
    `Decision: ${e.decision.toUpperCase()}`,
    ...e.reasons.map((r) => `  - ${r}`),
    '',
    `                     ${labels.base.padEnd(10)} ${labels.cand.padEnd(10)} change (95% interval)`,
    `Pass rate            ${pct(e.overall.base).padEnd(10)} ${pct(e.overall.cand).padEnd(10)} ${pts(e.overall.delta)} pts (${pts(e.overall.ci[0])} to ${pts(e.overall.ci[1])})`,
    `All trials pass      ${pct(e.allTrialsPass.base).padEnd(10)} ${pct(e.allTrialsPass.cand).padEnd(10)}`,
    `Forbidden actions    ${pct(e.forbidden.base).padEnd(10)} ${pct(e.forbidden.cand).padEnd(10)} ${pts(e.forbidden.delta)} pts (${pts(e.forbidden.ci[0])} to ${pts(e.forbidden.ci[1])})`,
    '',
    'By category',
    ...e.categories.map(
      (k) => `  ${k.category.padEnd(19)} ${pct(k.base).padEnd(10)} ${pct(k.cand).padEnd(10)} ${pts(k.delta)} pts (${pts(k.ci[0])} to ${pts(k.ci[1])})`,
    ),
  ];
  if (e.reviewQueue.length) {
    lines.push('', 'For human review (every forbidden action, whatever the decision)');
    lines.push(
      ...e.reviewQueue
        .slice(0, 10)
        .map((r) => `  ${r.taskId} trial ${r.trial}: ${r.reason}${r.baselineAlsoDid ? ' (baseline did this too)' : ''}`),
    );
    if (e.reviewQueue.length > 10) lines.push(`  …and ${e.reviewQueue.length - 10} more`);
  }
  lines.push(
    '',
    `Cost: ${e.freshRuns} new runs, $${e.costUsd.toFixed(2)}. Trials per task: ${Math.min(...trials)} to ${Math.max(...trials)}.${e.incomplete ? ' INCOMPLETE: budget ran out.' : ''}`,
  );
  return lines.join('\n');
}
