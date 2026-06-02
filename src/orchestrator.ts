import Anthropic from '@anthropic-ai/sdk';
import type { ResearchTask, Finding } from './types.js';

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const MAX_AGENTS = Math.min(parseInt(process.env.MAX_AGENTS ?? '5', 10), 5);

const PLAN_PROMPT = `You are a research orchestrator. Given a user intent, output ONLY a JSON array of at most ${MAX_AGENTS} research tasks. No prose, no markdown code fences — raw JSON only.

Each task object must have exactly these fields:
  "role": a short name for this research angle (e.g. "Market Size", "Competitor Analysis")
  "subQuestion": the specific question this task answers
  "queries": an array of 1-2 search query strings

Rules:
- Tasks must be non-overlapping and together cover the intent fully
- Maximum ${MAX_AGENTS} tasks
- Prefer 3-4 focused tasks over 5 broad ones
- Return ONLY the JSON array, nothing else`;

const SYNTHESIS_PROMPT = `You are a senior research analyst. Given a user intent and research findings from multiple agents, write a decision-useful answer.

Rules:
- Cite source URLs inline using [Title](url) format whenever you reference specific claims
- Note disagreements or contradictions between sources
- Structure the answer clearly (use headers if the answer is long)
- End with a concise recommendation or conclusion
- Be direct — this is for decision-making, not academic writing`;

export interface WorkerFinding {
  taskIndex: number;
  role: string;
  subQuestion: string;
  findings: Finding[];
  serviceUsed: string;
  spend: number;
  txHashes: string[];
}

export async function plan(intent: string): Promise<ResearchTask[]> {
  let tasks: ResearchTask[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0
      ? `User intent: "${intent}"\n\nOutput the JSON array of research tasks.`
      : `User intent: "${intent}"\n\nOutput ONLY a valid JSON array. No explanation, no markdown, no code fences. Start with [ and end with ].`;

    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'user', content: `${PLAN_PROMPT}\n\n${prompt}` },
      ],
    });

    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';

    try {
      // Strip any accidental markdown fences
      const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        tasks = parsed as ResearchTask[];
        break;
      }
    } catch {
      if (attempt === 1) {
        console.warn('Plan parsing failed twice, falling back to single task');
        tasks = [{
          role: 'General Research',
          subQuestion: intent,
          queries: [intent],
        }];
      }
    }
  }

  // Hard backstop: never spawn more than MAX_AGENTS
  tasks = tasks.slice(0, MAX_AGENTS);
  return tasks;
}

export async function synthesize(
  intent: string,
  workerFindings: WorkerFinding[],
): Promise<string> {
  const findingsText = workerFindings
    .map((wf) => {
      const sources = wf.findings
        .map((f) => `  - [${f.title}](${f.url}): ${f.content.slice(0, 400)}`)
        .join('\n');
      return `### ${wf.role}: ${wf.subQuestion}\n${sources || '  (no results)'}`;
    })
    .join('\n\n');

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `${SYNTHESIS_PROMPT}\n\nUser intent: "${intent}"\n\n## Research Findings\n\n${findingsText}\n\nWrite the answer now.`,
      },
    ],
  });

  return msg.content[0].type === 'text' ? msg.content[0].text : '(synthesis failed)';
}
