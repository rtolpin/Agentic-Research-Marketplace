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

type TaskCategory =
  | 'finance'
  | 'legal'
  | 'academic'
  | 'local'
  | 'news'
  | 'ecommerce'
  | 'real_estate'
  | 'weather'
  | 'travel'
  | 'jobs'
  | 'social'
  | 'general';

const CATEGORY_SIGNALS: Record<TaskCategory, string[]> = {
  finance: [
    'stock', 'price', 'market cap', 'earnings', 'revenue', 'valuation', 'invest',
    'fund', 'portfolio', 'equity', 'bond', 'crypto', 'trading', 'financial',
    'profit', 'loss', 'ipo', 'dividend', 'etf', 'nasdaq', 'nyse', 'forex',
    'gdp', 'inflation', 'interest rate', 'market data', 'ticker',
  ],
  legal: [
    'regulation', 'regulatory', 'law', 'legal', 'compliance', 'import', 'export',
    'tariff', 'customs', 'permit', 'license', 'statute', 'legislation', 'tax',
    'gdpr', 'policy', 'visa', 'trademark', 'patent', 'contract', 'liability',
    'sec filing', 'edgar', 'enforcement',
  ],
  academic: [
    'research', 'study', 'paper', 'journal', 'clinical', 'trial', 'evidence',
    'science', 'survey', 'meta-analysis', 'peer-reviewed', 'university',
    'academic', 'publication', 'findings', 'citation',
  ],
  local: [
    'near me', 'nearby', 'store', 'shop', 'restaurant', 'buy', 'where to',
    'local', 'neighborhood', 'borough', 'best place', 'google maps',
    'places', 'address', 'directions',
  ],
  news: [
    'news', 'headline', 'latest', 'breaking', 'current events', 'recent',
    'today', 'announcement', 'press release', 'media', 'article', 'coverage',
    'sentiment', 'trending',
  ],
  ecommerce: [
    'product', 'price comparison', 'amazon', 'buy online', 'shop online',
    'listing', 'ecommerce', 'retail', 'reviews', 'best deal', 'discount',
    'marketplace', 'seller',
  ],
  real_estate: [
    'real estate', 'property', 'home', 'house', 'apartment', 'rent', 'buy',
    'mortgage', 'zillow', 'listing', 'neighborhood', 'housing market',
    'price per sqft', 'cap rate', 'rental yield',
  ],
  weather: [
    'weather', 'forecast', 'temperature', 'climate', 'rain', 'snow',
    'wind', 'humidity', 'storm', 'seasonal',
  ],
  travel: [
    'travel', 'flight', 'hotel', 'trip', 'destination', 'vacation',
    'tourism', 'airline', 'booking', 'itinerary', 'visa', 'passport',
  ],
  jobs: [
    'job', 'hiring', 'salary', 'career', 'employment', 'recruiter',
    'linkedin', 'glassdoor', 'remote work', 'compensation', 'role',
  ],
  social: [
    'social media', 'twitter', 'instagram', 'tiktok', 'viral', 'influencer',
    'engagement', 'followers', 'brand sentiment', 'social listening',
  ],
  general: [],
};

// Bazaar query strings tuned to match actual registered service descriptions
const CATEGORY_BAZAAR_QUERIES: Record<TaskCategory, string> = {
  finance:      'real-time stock market data financial quotes OHLCV',
  legal:        'regulatory compliance law enforcement filings',
  academic:     'academic paper search research citations discovery',
  local:        'google maps places nearby search geocode',
  news:         'news articles headlines search sentiment',
  ecommerce:    'amazon product search listings price reviews',
  real_estate:  'real estate listings zillow property data',
  weather:      'weather forecast temperature current conditions',
  travel:       'flights hotels travel destination search',
  jobs:         'job listings hiring salary search linkedin',
  social:       'social media posts sentiment engagement analytics',
  general:      '',
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
  // Search without network filter to get the full catalog;
  // x402 payment validation happens at call time in payment.ts
  const response = await searchX402Resources({ query: query.slice(0, 400), limit: 10 });
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
 * Categorizes the task across 12 domains and queries the x402 Bazaar with
 * a targeted search term for that category, then falls back to the raw
 * sub-question, then to null (caller falls back to Tavily).
 * Never throws.
 */
export async function discoverService(task: ResearchTask): Promise<ServiceInfo | null> {
  if (process.env.USE_DISCOVERY !== 'true') return null;

  const category = categorizeTask(task);
  console.log(`[discovery] Task "${task.role}" → category: ${category}`);

  try {
    if (category !== 'general') {
      const specialist = await queryBazaar(CATEGORY_BAZAAR_QUERIES[category]);
      if (specialist) {
        console.log(`[discovery] Specialist: "${specialist.name}" ($${specialist.priceUsd.toFixed(4)}) [${category}]`);
        return { ...specialist, category };
      }
      console.log(`[discovery] No specialist for ${category}, falling back to sub-question query`);
    }

    const general = await queryBazaar(task.subQuestion);
    if (general) {
      console.log(`[discovery] General match: "${general.name}" for "${task.role}"`);
      return { ...general, category };
    }

    console.log(`[discovery] No Bazaar match for "${task.role}" — using Tavily`);
    return null;
  } catch (err) {
    console.warn('[discovery] Bazaar query failed:', (err as Error).message);
    return null;
  }
}
