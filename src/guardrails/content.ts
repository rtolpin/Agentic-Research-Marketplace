import type { Finding } from '../types.js';
import { stripInvisible } from './input.js';

const MAX_FINDING_CHARS = 2000;
const MAX_TITLE_CHARS = 200;

// Phrases typical of indirect prompt injection planted in web pages.
const INJECTION_PATTERNS = [
  /ignore (all |any )?(the )?(previous|prior|above) (instructions|prompts?)/i,
  /disregard (all |any )?(the )?(previous|prior|above|your) (instructions|rules)/i,
  /you are now\b/i,
  /new instructions\s*:/i,
  /system prompt/i,
  /<\/?\s*(system|assistant|instructions?|search_results|source)\b/i,
  /\b(assistant|system)\s*:\s/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Neutralizes angle brackets so source text can't close or open prompt delimiters. */
export function neutralize(text: string): string {
  return stripInvisible(text).replace(/</g, '‹').replace(/>/g, '›');
}

/**
 * Cleans search results before they reach the model or the browser:
 * drops findings without an http(s) URL (blocks javascript: links in the UI),
 * bounds lengths, and flags likely prompt-injection text.
 */
export function sanitizeFindings(findings: Finding[]): { findings: Finding[]; dropped: number; injectionFlags: number } {
  let dropped = 0;
  let injectionFlags = 0;
  const out: Finding[] = [];
  for (const f of findings) {
    const url = safeUrl(f.url);
    if (!url) {
      dropped++;
      continue;
    }
    const content = stripInvisible(String(f.content ?? '')).slice(0, MAX_FINDING_CHARS);
    const title = stripInvisible(String(f.title ?? '(no title)')).slice(0, MAX_TITLE_CHARS);
    const suspicious = looksLikeInjection(`${title} ${content}`);
    if (suspicious) injectionFlags++;
    out.push({ title, url, content, score: f.score, ...(suspicious ? { suspicious: true } : {}) });
  }
  return { findings: out, dropped, injectionFlags };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

const MD_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * Keeps only citations to URLs the agents actually retrieved. Links to anything
 * else (hallucinated, or planted by an injected page) are unlinked to plain text.
 */
export function groundCitations(answer: string, sourceUrls: string[]): { answer: string; cited: number; ungrounded: string[] } {
  const allowed = new Set(sourceUrls.map(normalizeUrl));
  const ungrounded: string[] = [];
  let cited = 0;
  const grounded = answer.replace(MD_LINK, (match, text: string, url: string) => {
    if (allowed.has(normalizeUrl(url))) {
      cited++;
      return match;
    }
    ungrounded.push(url);
    return text;
  });
  return { answer: grounded, cited, ungrounded };
}

// Decision areas where the answer should carry a professional-advice notice.
const REGULATED_TOPICS = /\b(invest(ing|ment)?|stocks?|crypto|portfolio|retire(ment)?|mortgage|loan|tax(es)?|legal|lawsuit|sue|contract|visa|immigration|medical|medication|diagnos\w*|symptoms?|treatment|health)\b/i;

export const ADVICE_NOTICE = '_This analysis is for research purposes only and is not financial, legal, tax or medical advice. Consult a qualified professional before acting on it._';

export function needsAdviceNotice(intent: string): boolean {
  return REGULATED_TOPICS.test(intent);
}

/** Output guardrails applied to every synthesized answer before it is shown. */
export function applyOutputGuardrails(intent: string, rawAnswer: string, sourceUrls: string[]) {
  const grounded = groundCitations(rawAnswer, sourceUrls);
  const adviceNoticeAdded = needsAdviceNotice(intent);
  return {
    answer: adviceNoticeAdded ? `${grounded.answer}\n\n${ADVICE_NOTICE}` : grounded.answer,
    citationsKept: grounded.cited,
    ungroundedCitations: grounded.ungrounded,
    adviceNoticeAdded,
  };
}
