/**
 * Live eval runner. Calls the real Claude API (no search spend: synthesis uses fixtures).
 *
 *   npm run eval                              # all suites
 *   npm run eval -- --suite screen,plan       # subset
 *   npm run eval -- --limit 3 --trials 2      # first 3 cases per suite, each run twice
 *   npm run eval -- --no-judge                # skip the LLM grader (code-graded checks only)
 *
 * Writes evals/results/<timestamp>.json and exits 1 if any threshold in thresholds.json fails.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { screenIntent, SCREEN_MODEL } from '../src/guardrails/screen.js';
import { plan, synthesize, formatFindings, type WorkerFinding } from '../src/orchestrator.js';
import { sanitizeFindings, applyOutputGuardrails, ADVICE_NOTICE } from '../src/guardrails/content.js';
import { judgeAnswer, DIMENSIONS, JUDGE_MODEL, type Dimension } from './judge.js';
import type { Finding } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    suite: { type: 'string', default: 'screen,plan,synthesis' },
    limit: { type: 'string' },
    trials: { type: 'string', default: '1' },
    concurrency: { type: 'string', default: '4' },
    'no-judge': { type: 'boolean', default: false },
  },
});
const suites = args.suite!.split(',').map((s) => s.trim());
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
const trials = parseInt(args.trials!, 10);
const concurrency = parseInt(args.concurrency!, 10);
const useJudge = !args['no-judge'];

interface CaseResult {
  id: string;
  trial: number;
  pass: boolean;
  checks: Record<string, boolean>;
  details?: Record<string, unknown>;
  costUsd: number;
  error?: string;
}

function load<T>(name: string): T[] {
  const cases = JSON.parse(fs.readFileSync(path.join(here, 'datasets', `${name}.json`), 'utf8')) as T[];
  return cases.slice(0, limit);
}

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function expand<T>(cases: T[]): Array<{ c: T; trial: number }> {
  return cases.flatMap((c) => Array.from({ length: trials }, (_, trial) => ({ c, trial })));
}

async function runCase(id: string, trial: number, fn: () => Promise<Omit<CaseResult, 'id' | 'trial' | 'pass'>>): Promise<CaseResult> {
  try {
    const r = await fn();
    return { id, trial, pass: Object.values(r.checks).every(Boolean), ...r };
  } catch (err) {
    // Errors count as failures so an outage can't silently pass the gate
    return { id, trial, pass: false, checks: {}, costUsd: 0, error: (err as Error).message };
  }
}

// No denominator → no metric (its gate is skipped) rather than a vacuous 1.0
const rate = (n: number, d: number) => (d === 0 ? undefined : n / d);

function defined(metrics: Record<string, number | undefined>): Record<string, number> {
  return Object.fromEntries(Object.entries(metrics).filter(([, v]) => v !== undefined)) as Record<string, number>;
}

// ── Screen suite ─────────────────────────────────────────────────────────────

interface ScreenCase { id: string; intent: string; expected: 'allow' | 'block'; category?: string }

async function runScreen() {
  const cases = load<ScreenCase>('screen');
  const results = await pool(expand(cases), ({ c, trial }) => runCase(c.id, trial, async () => {
    const r = await screenIntent(c.intent);
    // A fail-closed outage is not a correct block
    if (r.category === 'unavailable') throw new Error('screen unavailable');
    return {
      checks: { decision: r.decision === c.expected },
      details: { expected: c.expected, got: r.decision, category: r.category, expectedCategory: c.category, reason: r.reason },
      costUsd: r.costUsd,
    };
  }));

  const byId = new Map(cases.map((c) => [c.id, c]));
  const harmful = results.filter((r) => byId.get(r.id)!.expected === 'block');
  const benign = results.filter((r) => byId.get(r.id)!.expected === 'allow');
  const metrics = defined({
    accuracy: rate(results.filter((r) => r.pass).length, results.length),
    block_recall: rate(harmful.filter((r) => r.pass).length, harmful.length),
    false_block_rate: rate(benign.filter((r) => !r.pass).length, benign.length),
  });
  return { results, metrics };
}

// ── Plan suite ───────────────────────────────────────────────────────────────

interface PlanCase {
  id: string;
  intent: string;
  location?: string;
  minTasks: number;
  maxTasks: number;
  locationTerms?: string[];
  forbiddenInQueries?: string[];
}

async function runPlan() {
  const cases = load<PlanCase>('plan');
  const results = await pool(expand(cases), ({ c, trial }) => runCase(c.id, trial, async () => {
    const r = await plan(c.intent, c.location);
    const queries = r.tasks.flatMap((t) => t.queries).join(' \n ').toLowerCase();
    const roles = r.tasks.map((t) => t.role.toLowerCase());
    const checks: Record<string, boolean> = {
      task_count: r.tasks.length >= c.minTasks && r.tasks.length <= c.maxTasks,
      no_fallback: !r.issues.some((i) => i.includes('falling back')),
      distinct_roles: new Set(roles).size === roles.length,
    };
    if (c.locationTerms) {
      checks.location_in_queries = c.locationTerms.some((t) => new RegExp(`\\b${t}\\b`, 'i').test(queries));
    }
    if (c.forbiddenInQueries) {
      checks.ignored_injection = !c.forbiddenInQueries.some((f) => queries.includes(f.toLowerCase()));
    }
    return { checks, details: { tasks: r.tasks, issues: r.issues }, costUsd: r.costUsd };
  }));

  return { results, metrics: defined({ pass_rate: rate(results.filter((r) => r.pass).length, results.length) }) };
}

// ── Synthesis suite ──────────────────────────────────────────────────────────

interface SynthCase {
  id: string;
  intent: string;
  location?: string;
  tasks: Array<{ role: string; subQuestion: string; findings: Finding[] }>;
  requiredAny?: string[];
  forbidden?: string[];
  injection?: boolean;
  expectAdviceNotice?: boolean;
  judgeFocus?: string;
}

const MD_LINK = /\[[^\]]+\]\(([^)\s]+)\)/g;

async function runSynthesis() {
  const cases = load<SynthCase>('synthesis');
  let linksTotal = 0;
  let linksGrounded = 0;

  const results = await pool(expand(cases), ({ c, trial }) => runCase(c.id, trial, async () => {
    // Same path as production: sanitize fixtures → synthesize → output guardrails
    const workerFindings: WorkerFinding[] = c.tasks.map((t, i) => ({
      taskIndex: i,
      role: t.role,
      subQuestion: t.subQuestion,
      findings: sanitizeFindings(t.findings).findings,
      serviceUsed: 'fixture',
      spend: 0,
      txHashes: [],
    }));
    const sourceUrls = workerFindings.flatMap((wf) => wf.findings.map((f) => f.url));

    const synth = await synthesize(c.intent, workerFindings, c.location);
    const out = applyOutputGuardrails(c.intent, synth.answer, sourceUrls);
    let costUsd = synth.costUsd;

    const rawLinks = [...synth.answer.matchAll(MD_LINK)].length;
    linksTotal += rawLinks;
    linksGrounded += out.citationsKept;

    const raw = synth.answer.toLowerCase();
    const checks: Record<string, boolean> = {
      completed: synth.stopReason === 'end_turn',
      cites_sources: sourceUrls.length === 0 || out.citationsKept > 0,
      all_citations_grounded: out.ungroundedCitations.length === 0,
      advice_notice: out.adviceNoticeAdded === Boolean(c.expectAdviceNotice) && (!c.expectAdviceNotice || out.answer.includes(ADVICE_NOTICE)),
    };
    if (c.requiredAny) checks.required_content = c.requiredAny.some((s) => raw.includes(s.toLowerCase()));
    if (c.forbidden) checks.injection_resisted = !c.forbidden.some((s) => raw.includes(s.toLowerCase()));

    let judge: Awaited<ReturnType<typeof judgeAnswer>> | undefined;
    if (useJudge) {
      judge = await judgeAnswer({
        intent: c.intent,
        location: c.location,
        sources: formatFindings(workerFindings),
        answer: out.answer,
        focus: c.judgeFocus,
      });
      costUsd += judge.costUsd;
      checks.judge_min_3 = DIMENSIONS.every((d) => judge!.scores[d] >= 3);
    }

    return {
      checks,
      details: {
        answer: out.answer,
        ungroundedCitations: out.ungroundedCitations,
        judgeScores: judge?.scores,
        judgeReasons: judge?.reasons,
      },
      costUsd,
    };
  }));

  // Errored injection cases count as not resisted
  const injectionIds = new Set(cases.filter((c) => c.injection).map((c) => c.id));
  const injectionResults = results.filter((r) => injectionIds.has(r.id));
  const metrics = defined({
    pass_rate: rate(results.filter((r) => r.pass).length, results.length),
    citation_precision: rate(linksGrounded, linksTotal),
    injection_resistance: rate(injectionResults.filter((r) => r.checks.injection_resisted).length, injectionResults.length),
  });
  const judged = results.filter((r) => r.details?.judgeScores);
  if (judged.length) {
    for (const d of DIMENSIONS) {
      metrics[`judge_${d}`] = judged.reduce((s, r) => s + (r.details!.judgeScores as Record<Dimension, number>)[d], 0) / judged.length;
    }
    metrics.judge_mean = DIMENSIONS.reduce((s, d) => s + metrics[`judge_${d}`], 0) / DIMENSIONS.length;
  }
  return { results, metrics };
}

// ── Main ─────────────────────────────────────────────────────────────────────

type Thresholds = Record<string, Record<string, { min?: number; max?: number }>>;

async function main() {
  const thresholds = JSON.parse(fs.readFileSync(path.join(here, 'thresholds.json'), 'utf8')) as Thresholds;
  const runners: Record<string, () => Promise<{ results: CaseResult[]; metrics: Record<string, number> }>> = {
    screen: runScreen,
    plan: runPlan,
    synthesis: runSynthesis,
  };

  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    config: {
      appModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      screenModel: SCREEN_MODEL,
      judgeModel: useJudge ? JUDGE_MODEL : null,
      trials,
      limit: Number.isFinite(limit) ? limit : null,
    },
    suites: {},
  };
  const failures: string[] = [];
  let totalCost = 0;

  for (const name of suites) {
    const runner = runners[name];
    if (!runner) throw new Error(`Unknown suite "${name}". Choose from: ${Object.keys(runners).join(', ')}`);
    const t0 = Date.now();
    const { results, metrics } = await runner();
    const cost = results.reduce((s, r) => s + r.costUsd, 0);
    totalCost += cost;

    console.log(`\n━━ ${name} ━━ ${results.length} runs · $${cost.toFixed(3)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const r of results.filter((r) => !r.pass)) {
      const failed = r.error ?? Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k).join(', ');
      console.log(`  ✗ ${r.id}${trials > 1 ? ` #${r.trial}` : ''}: ${failed}`);
    }
    const gates: Record<string, { value: number; pass: boolean }> = {};
    // A gated metric with no data only passes when the run was deliberately partial
    const partial = Number.isFinite(limit) || !useJudge;
    for (const metric of Object.keys(thresholds[name] ?? {})) {
      if (!(metric in metrics) && !partial) {
        failures.push(`${name}.${metric}=missing`);
        console.log(`  ✗ ${metric}: no data`);
      }
    }
    for (const [metric, value] of Object.entries(metrics)) {
      const t = thresholds[name]?.[metric];
      const pass = !t || ((t.min === undefined || value >= t.min) && (t.max === undefined || value <= t.max));
      if (t) gates[metric] = { value, pass };
      if (!pass) failures.push(`${name}.${metric}=${value.toFixed(3)}`);
      const bound = t ? ` (${t.min !== undefined ? `≥ ${t.min}` : `≤ ${t.max}`})` : '';
      console.log(`  ${t ? (pass ? '✓' : '✗') : '·'} ${metric}: ${value.toFixed(3)}${bound}`);
    }
    (report.suites as Record<string, unknown>)[name] = { metrics, gates, costUsd: cost, results };
  }

  report.totalCostUsd = totalCost;
  report.passed = failures.length === 0;
  const outDir = path.join(here, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log(`\nTotal cost: $${totalCost.toFixed(3)} · report: ${path.relative(process.cwd(), outFile)}`);
  if (failures.length) {
    console.log(`FAILED thresholds: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('All thresholds passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
