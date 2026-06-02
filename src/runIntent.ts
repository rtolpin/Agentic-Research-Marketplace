import { plan, synthesize, type WorkerFinding } from './orchestrator.js';
import { runWorker } from './worker.js';
import { discoverService, TAVILY_DEFAULT } from './discovery.js';
import { getWalletAddress } from './payment.js';
import * as ledger from './ledger.js';
import type { IntentResult, WorkerResult } from './types.js';

export type ProgressUpdate =
  | { type: 'planning' }
  | { type: 'plan_ready'; tasks: IntentResult['tasks'] }
  | { type: 'worker_start'; taskIndex: number; role: string; service: string; serviceSource: string }
  | { type: 'worker_done'; result: WorkerResult }
  | { type: 'synthesizing' }
  | { type: 'done'; result: IntentResult };

/**
 * End-to-end intent runner.
 * plan → (discover per task) → spawn workers → synthesize
 */
export async function runIntent(
  intent: string,
  onUpdate?: (update: ProgressUpdate) => void,
  location?: string,
): Promise<IntentResult> {
  const emit = (u: ProgressUpdate) => onUpdate?.(u);

  // Distribute global budget evenly across workers (pessimistic: assume MAX_AGENTS)
  const maxAgents = parseInt(process.env.MAX_AGENTS ?? '5', 10);
  const perWorkerBudget = ledger.getMaxSpend() / maxAgents;

  // 1. Plan
  emit({ type: 'planning' });
  console.log(`\n[runIntent] Planning for: "${intent}"${location ? ` (location: ${location})` : ''}`);
  const tasks = await plan(intent, location);
  console.log(`[runIntent] Plan: ${tasks.length} tasks`);
  tasks.forEach((t, i) => console.log(`  [${i}] ${t.role}: ${t.subQuestion}`));
  emit({ type: 'plan_ready', tasks });

  const walletAddress = await getWalletAddress();

  // 2. Workers run sequentially
  const workerResults: WorkerResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
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
    });

    const result = await runWorker(task, service, perWorkerBudget, i);
    workerResults.push(result);
    emit({ type: 'worker_done', result });
  }

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

  const answer = await synthesize(intent, workerFindings, location);

  const totalSpend = ledger.getTotalSpend();
  console.log(`[runIntent] Done. Total spend: $${totalSpend.toFixed(4)}`);

  const intentResult: IntentResult = {
    intent,
    tasks,
    workerResults,
    answer,
    totalSpend,
    walletAddress,
  };

  emit({ type: 'done', result: intentResult });
  return intentResult;
}
