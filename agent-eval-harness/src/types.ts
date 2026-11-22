/**
 * Shared types for the agent evaluation harness.
 *
 * Purpose: describe test tasks, what the agent did, and how a run is graded.
 * Dependencies: none.
 */

export interface Order {
  id: string;
  customerId: string;
  totalCents: number;
  status: 'processing' | 'shipped' | 'delivered';
  /** Days since delivery; only set when status is 'delivered'. */
  deliveredDaysAgo?: number;
}

export interface KbArticle {
  id: string;
  title: string;
  body: string;
}

/** The world a task runs in: the orders and help articles its tools can see. */
export interface Fixture {
  orders: Order[];
  kb: KbArticle[];
}

export type ToolName = 'lookup_order' | 'issue_refund' | 'search_kb';

/** One tool call the agent made, recorded by the sandbox. */
export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
}

/** The tools an agent gets. In evaluation these are sandboxed fakes (see sandbox.ts). */
export interface Tools {
  lookup_order(orderId: string): Promise<Order | null>;
  issue_refund(orderId: string, amountCents: number): Promise<{ refundId: string }>;
  search_kb(query: string): Promise<KbArticle[]>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** The agent under test, behind one interface so any version can be plugged in. */
export interface Agent {
  /** Identifies the prompt + model + code combination. Part of every cache key. */
  version: string;
  run(input: { ticket: string; customerId: string }, tools: Tools): Promise<{ finalMessage: string; usage: Usage }>;
}

/** Thrown for provider or network failures that say nothing about the agent's quality. */
export class InfraError extends Error {
  readonly retryable = true;
}

/**
 * A single condition on what the agent did. Checks read the recorded tool
 * calls and the final reply, never the agent's reasoning.
 */
export type Check =
  /** A refund on this order succeeded. Amount omitted = any amount. */
  | { kind: 'refunded'; orderId: string; amountCents?: number }
  /** No refund succeeded at all. */
  | { kind: 'noRefund' }
  /** A successful refund exceeded this amount. Used in `forbidden`. */
  | { kind: 'refundOver'; cents: number }
  /** A refund succeeded on any order other than this one. Used in `forbidden`. */
  | { kind: 'refundedOtherThan'; orderId: string }
  /** The reply cites at least one of these article ids, such as "KB-104". */
  | { kind: 'citesAnyOf'; articleIds: string[] }
  /** The reply contains at least one of these phrases (case-insensitive). */
  | { kind: 'mentionsAnyOf'; phrases: string[] };

export interface Expectation {
  /**
   * The task passes if ANY one of these outcomes holds; an outcome holds when
   * ALL its checks hold. A task with several valid answers lists each one.
   */
  acceptable: Check[][];
  /** If ANY of these holds, the run is a critical failure, whatever else happened. */
  forbidden: Check[];
}

export interface Task {
  id: string;
  /** Used to catch regressions hidden by an improving average. */
  category: string;
  ticket: string;
  customerId: string;
  fixture: Fixture;
  expect: Expectation;
}

/** The graded result of one run of one task. */
export interface TrialResult {
  taskId: string;
  trial: number;
  agentVersion: string;
  passed: boolean;
  /** Did something forbidden, such as an unauthorised refund. */
  critical: boolean;
  reason: string;
  costUsd: number;
}
