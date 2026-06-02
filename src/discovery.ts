import { searchX402Resources, type X402DiscoveryResource } from '@coinbase/cdp-sdk';
import { TAVILY_X402_URL } from './payment.js';
import type { ResearchTask, ServiceInfo } from './types.js';

const TAVILY_DEFAULT: ServiceInfo = {
  url: TAVILY_X402_URL,
  name: 'Tavily Advanced Search',
  priceUsd: 0.01,
  source: 'default',
};

export { TAVILY_DEFAULT };

type TaskCategory = 'finance' | 'legal' | 'academic' | 'local' | 'general';

const CATEGORY_SIGNALS: Record<TaskCategory, string[]> = {
  finance: [
    'stock', 'price', 'market cap', 'earnings', 'revenue', 'valuation', 'invest',
    'fund', 'portfolio', 'equity', 'bond', 'crypto', 'trading', 'financial',
    'profit', 'loss', 'ipo', 'dividend', 'etf', 'nasdaq', 'nyse', 'forex',
  ],
  legal: [
    'regulation', 'regulatory', 'law', 'legal', 'compliance', 'import', 'export',
    'tariff', 'customs', 'permit', 'license', 'statute', 'legislation', 'tax',
    'gdpr', 'policy', 'visa', 'trademark', 'patent', 'contract', 'liability',
  ],
  academic: [
    'research', 'study', 'paper', 'journal', 'clinical', 'trial', 'evidence',
    'science', 'data', 'survey', 'meta-analysis', 'peer-reviewed', 'university',
    'academic', 'publication', 'findings', 'statistics',
  ],
  local: [
    'near me', 'nearby', 'in ', 'restaurant', 'store', 'shop', 'buy', 'where to',
    'local', 'neighborhood', 'city', 'district', 'borough', 'best place',
  ],
  general: [],
};

const CATEGORY_BAZAAR_QUERIES: Record<TaskCategory, string> = {
  finance: 'financial data stock market prices real-time',
  legal: 'legal regulatory compliance database',
  academic: 'academic research papers scientific data',
  local: 'local search places directory',
  general: '',
};

function categorizeTask(task: ResearchTask): TaskCategory {
  const text = `${task.role} ${task.subQuestion}`.toLowerCase();

  for (const [category, signals] of Object.entries(CATEGORY_SIGNALS) as [TaskCategory, string[]][]) {
    if (category === 'general') continue;
    if (signals.some((s) => text.includes(s))) return category;
  }
  return 'general';
}

function extractPriceUsd(resource: X402DiscoveryResource): number {
  const accepts = (resource as unknown as Record<string, unknown>)?.accepts as Array<Record<string, unknown>> | undefined;
  if (!accepts?.length) return 0.01;

  const baseEntry = accepts.find(
    (a) => typeof a.network === 'string' && a.network.includes('8453'),
  ) ?? accepts[0];

  const raw = baseEntry?.maxAmountRequired ?? baseEntry?.amount ?? baseEntry?.price;
  if (raw === undefined) return 0.01;

  const atomic = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!isFinite(atomic) || atomic <= 0) return 0.01;
  return atomic / 1_000_000;
}

async function queryBazaar(query: string): Promise<ServiceInfo | null> {
  const response = await searchX402Resources({
    query: query.slice(0, 400),
    network: 'eip155:8453',
    limit: 10,
  });

  const resources = response?.resources ?? [];
  const candidates = resources
    .filter((r) => r.type === 'http' && r.resource?.startsWith('https://'))
    .filter((r) => r.resource !== TAVILY_X402_URL)
    .map((r) => ({
      url: r.resource,
      name: r.description?.slice(0, 60) ?? new URL(r.resource).hostname,
      priceUsd: extractPriceUsd(r),
      source: 'discovered' as const,
    }))
    .sort((a, b) => a.priceUsd - b.priceUsd);

  return candidates[0] ?? null;
}

/**
 * Categorizes the task and queries the x402 Bazaar with a targeted search term
 * for that category first, then falls back to the raw sub-question.
 * Returns null on any error or no results — callers must fall back to Tavily.
 * Never throws.
 */
export async function discoverService(task: ResearchTask): Promise<ServiceInfo | null> {
  if (process.env.USE_DISCOVERY !== 'true') return null;

  const category = categorizeTask(task);
  console.log(`[discovery] Task "${task.role}" categorized as: ${category}`);

  try {
    // For non-general tasks, try a category-specific Bazaar query first
    if (category !== 'general') {
      const categoryQuery = CATEGORY_BAZAAR_QUERIES[category];
      const specialist = await queryBazaar(categoryQuery);
      if (specialist) {
        console.log(`[discovery] Specialist match: "${specialist.name}" ($${specialist.priceUsd.toFixed(4)}) for category: ${category}`);
        return { ...specialist, category };
      }
      console.log(`[discovery] No specialist found for ${category}, trying sub-question query`);
    }

    // Fall back to querying with the actual sub-question
    const general = await queryBazaar(task.subQuestion);
    if (general) {
      console.log(`[discovery] General match: "${general.name}" ($${general.priceUsd.toFixed(4)}) for: "${task.role}"`);
      return { ...general, category };
    }

    console.log(`[discovery] No Bazaar results for: "${task.role}" — using Tavily`);
    return null;
  } catch (err) {
    console.warn('[discovery] Bazaar query failed:', (err as Error).message);
    return null;
  }
}
