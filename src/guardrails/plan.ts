import type { ResearchTask } from '../types.js';
import { stripInvisible } from './input.js';

const MAX_ROLE_CHARS = 60;
const MAX_SUBQUESTION_CHARS = 300;
const MAX_QUERY_CHARS = 400; // Tavily rejects longer queries

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const s = stripInvisible(value).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Validates planner output (untrusted model JSON) into well-formed tasks:
 * required fields present, lengths bounded, queries deduplicated across tasks,
 * at most `maxTasks`. Falls back to a single task on the raw intent if nothing survives.
 */
export function sanitizePlan(
  raw: unknown,
  intent: string,
  maxTasks: number,
  maxQueries = 2,
): { tasks: ResearchTask[]; issues: string[] } {
  const issues: string[] = [];
  const items = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) issues.push('plan was not an array');

  const seenQueries = new Set<string>();
  const tasks: ResearchTask[] = [];

  items.forEach((item, i) => {
    const t = (item ?? {}) as Record<string, unknown>;
    const role = clean(t.role, MAX_ROLE_CHARS);
    const subQuestion = clean(t.subQuestion, MAX_SUBQUESTION_CHARS);
    if (!role || !subQuestion) {
      issues.push(`task ${i}: missing role or subQuestion`);
      return;
    }
    const queries: string[] = [];
    for (const q of Array.isArray(t.queries) ? t.queries : []) {
      const query = clean(q, MAX_QUERY_CHARS);
      if (!query) continue;
      const key = query.toLowerCase();
      if (seenQueries.has(key)) {
        issues.push(`task ${i}: duplicate query dropped`);
        continue;
      }
      seenQueries.add(key);
      queries.push(query);
    }
    if (!queries.length) {
      issues.push(`task ${i}: no usable queries, using subQuestion`);
      queries.push(subQuestion);
    }
    tasks.push({ role, subQuestion, queries: queries.slice(0, maxQueries) });
  });

  if (tasks.length > maxTasks) issues.push(`plan had ${tasks.length} tasks, truncated to ${maxTasks}`);
  const bounded = tasks.slice(0, maxTasks);

  if (!bounded.length) {
    issues.push('no valid tasks, falling back to single task');
    const q = intent.slice(0, MAX_QUERY_CHARS);
    return { tasks: [{ role: 'General Research', subQuestion: intent, queries: [q] }], issues };
  }
  return { tasks: bounded, issues };
}
