import { plan, synthesize, type WorkerFinding } from './orchestrator.js';
import { runWorker } from './worker.js';
import { discoverService, TAVILY_DEFAULT } from './discovery.js';
import { getWalletAddress } from './payment.js';
import * as ledger from './ledger.js';
import { screenIntent, blockedMessage, type ScreenResult } from './guardrails/screen.js';
import { applyOutputGuardrails } from './guardrails/content.js';
import type { IntentResult, WorkerResult } from './types.js';

export type ProgressUpdate =
  | { type: 'screening' }
  | { type: 'planning' }
  | { type: 'plan_ready'; tasks: IntentResult['tasks'] }
  | { type: 'worker_start'; taskIndex: number; role: string; service: string; serviceSource: string; serviceCategory: string }
  | { type: 'worker_done'; result: WorkerResult }
  | { type: 'synthesizing' }
  | { type: 'done'; result: IntentResult };

/** Thrown when the input screen declines a request. `message` is safe to show the user. */
export class GuardrailBlockedError extends Error {
  constructor(message: string, readonly category: ScreenResult['category']) {
    super(message);
    this.name = 'GuardrailBlockedError';
  }
}

export class RunAbortedError extends Error {
  constructor() {
    super('Run aborted');
    this.name = 'RunAbortedError';
  }
}

/**
 * End-to-end intent runner. Expects a validated intent/location (see guardrails/input.ts).
 * screen → plan → (discover per task) → spawn workers → synthesize → ground citations
 *
 * `signal` stops further paid work when the client disconnects.
 */
export async function runIntent(
  intent: string,
  onUpdate?: (update: ProgressUpdate) => void,
  location?: string,
  signal?: AbortSignal,
): Promise<IntentResult> {
  const emit = (u: ProgressUpdate) => onUpdate?.(u);
  const checkAborted = () => {
    if (signal?.aborted) throw new RunAbortedError();
  };

  // Each run gets its own ledger so concurrent requests can't share or reset budgets
  const runLedger = ledger.startRun();

  // Distribute global budget evenly across workers (pessimistic: assume MAX_AGENTS)
  const maxAgents = parseInt(process.env.MAX_AGENTS ?? '5', 10);
  const perWorkerBudget = runLedger.maxSpend / maxAgents;

  // 0. Input screen — before any search money is spent
  emit({ type: 'screening' });
  const screen = await screenIntent(intent);
  let claudeCostUsd = screen.costUsd;
  if (screen.decision === 'block') {
    console.warn(`[guardrails] Blocked intent (${screen.category}): ${screen.reason}`);
    throw new GuardrailBlockedError(blockedMessage(screen), screen.category);
  }
  checkAborted();

  // 1. Plan
  emit({ type: 'planning' });
  console.log(`\n[runIntent] Planning for: "${intent}"${location ? ` (location: ${location})` : ''}`);
  const { tasks, costUsd: planCost, issues: planIssues } = await plan(intent, location);
  claudeCostUsd += planCost;
  console.log(`[runIntent] Plan: ${tasks.length} tasks, Claude cost: $${planCost.toFixed(4)}`);
  tasks.forEach((t, i) => console.log(`  [${i}] ${t.role}: ${t.subQuestion}`));
  if (planIssues.length) console.warn('[guardrails] Plan issues:', planIssues.join('; '));
  emit({ type: 'plan_ready', tasks });

  const walletAddress = await getWalletAddress();

  // 2. Workers run sequentially
  const workerResults: WorkerResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    checkAborted();
    const task = tasks[i];

    // Discovery: find best service for this task (falls back to Tavily)
    const discovered = await discoverService(task);
    const service = discovered ?? TAVILY_DEFAULT;

    emit({
      type: 'worker_start',
      taskIndex: i,
      role: task.role,
      service: service.name,
      serviceSource: service.source,
      serviceCategory: service.category ?? 'general',
    });

    const result = await runWorker(task, service, perWorkerBudget, i, runLedger, signal);
    workerResults.push(result);
    emit({ type: 'worker_done', result });
  }
  checkAborted();

  // 3. Synthesize
  emit({ type: 'synthesizing' });
  console.log('\n[runIntent] Synthesizing answer...');

  const workerFindings: WorkerFinding[] = workerResults.map((wr) => ({
    taskIndex: wr.taskIndex,
    role: wr.task.role,
    subQuestion: wr.task.subQuestion,
    findings: wr.findings,
    serviceUsed: wr.serviceUsed,
    spend: wr.spend,
    txHashes: wr.txHashes,
  }));

  const { answer: rawAnswer, costUsd: synthCost, stopReason } = await synthesize(intent, workerFindings, location);
  claudeCostUsd += synthCost;

  // 4. Output guardrails
  const sourceUrls = workerResults.flatMap((wr) => wr.findings.map((f) => f.url));
  const { answer, ...output } = applyOutputGuardrails(intent, rawAnswer, sourceUrls);
  if (output.ungroundedCitations.length) {
    console.warn(`[guardrails] Unlinked ${output.ungroundedCitations.length} citation(s) not in retrieved sources`);
  }

  const totalSpend = runLedger.getTotalSpend();
  console.log(`[runIntent] Done. Search spend: $${totalSpend.toFixed(4)}, Claude cost: $${claudeCostUsd.toFixed(4)}`);

  const intentResult: IntentResult = {
    intent,
    tasks,
    workerResults,
    answer,
    totalSpend,
    claudeCostUsd,
    walletAddress,
    guardrails: {
      planIssues,
      findingsDropped: workerResults.reduce((n, wr) => n + wr.findingsDropped, 0),
      injectionFlags: workerResults.reduce((n, wr) => n + wr.injectionFlags, 0),
      ...output,
      synthesisStopReason: stopReason,
    },
  };

  emit({ type: 'done', result: intentResult });
  return intentResult;
}
