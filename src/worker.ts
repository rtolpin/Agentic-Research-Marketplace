import { paidCall } from './payment.js';
import * as ledger from './ledger.js';
import type { ResearchTask, WorkerResult, Finding, ServiceInfo, TavilyResponse } from './types.js';

const MAX_QUERIES_PER_WORKER = Math.min(parseInt(process.env.MAX_QUERIES_PER_WORKER ?? '2', 10), 5);

function parseTavilyResults(data: unknown): Finding[] {
  const d = data as Partial<TavilyResponse>;
  if (!d?.results) return [];
  return d.results.map((r) => ({
    title: r.title ?? '(no title)',
    url: r.url ?? '',
    content: r.content ?? '',
    score: r.score,
  }));
}

/**
 * Runs a single research worker. Calls its assigned service for each query,
 * respects per-worker budget and global spend cap.
 */
export async function runWorker(
  task: ResearchTask,
  service: ServiceInfo,
  budget: number,
  taskIndex: number,
): Promise<WorkerResult> {
  const workerId = `worker-${taskIndex}`;
  const findings: Finding[] = [];
  const txHashes: string[] = [];
  let spend = 0;
  let queriesRun = 0;

  const queries = task.queries.slice(0, MAX_QUERIES_PER_WORKER);

  for (const query of queries) {
    if (spend + service.priceUsd > budget) {
      console.log(`[${workerId}] Per-worker budget exhausted, skipping remaining queries`);
      break;
    }
    if (!ledger.canSpend(service.priceUsd)) {
      console.log(`[${workerId}] Global spend cap reached`);
      break;
    }

    try {
      console.log(`[${workerId}] Querying "${query}" via ${service.name} (${service.url})`);
      const result = await paidCall(service.url, { query, max_results: 5, include_answer: true }, workerId);

      const newFindings = parseTavilyResults(result.data);
      findings.push(...newFindings);
      spend += result.costUsd;
      queriesRun++;
      if (result.txHash) txHashes.push(result.txHash);

      console.log(`[${workerId}] Got ${newFindings.length} results, cost: $${result.costUsd.toFixed(4)}`);
      if (result.txHash) {
        console.log(`[${workerId}] Tx: https://basescan.org/tx/${result.txHash}`);
      }
    } catch (err) {
      console.error(`[${workerId}] Query failed:`, (err as Error).message);
      // Continue to next query rather than aborting the whole worker
    }
  }

  return {
    taskIndex,
    task,
    findings,
    spend,
    queriesRun,
    txHashes,
    serviceUsed: service.name,
    serviceSource: service.source,
  };
}
