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

function extractPriceUsd(resource: X402DiscoveryResource): number {
  // accepts is an array of PaymentRequirements; pick the first eip155:8453 entry
  const accepts = (resource as unknown as Record<string, unknown>)?.accepts as Array<Record<string, unknown>> | undefined;
  if (!accepts?.length) return 0.01;

  const baseEntry = accepts.find(
    (a) => typeof a.network === 'string' && a.network.includes('8453'),
  ) ?? accepts[0];

  const raw = baseEntry?.maxAmountRequired ?? baseEntry?.amount ?? baseEntry?.price;
  if (raw === undefined) return 0.01;

  const atomic = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!isFinite(atomic) || atomic <= 0) return 0.01;
  // USDC has 6 decimals
  return atomic / 1_000_000;
}

/**
 * Queries the x402 Bazaar for a service matching the task.
 * Returns null on any error or empty results — callers must fall back to Tavily.
 * Never throws.
 */
export async function discoverService(task: ResearchTask): Promise<ServiceInfo | null> {
  if (process.env.USE_DISCOVERY !== 'true') return null;

  try {
    const response = await searchX402Resources({
      query: task.subQuestion.slice(0, 400),
      network: 'eip155:8453',
      limit: 10,
    });

    const resources = response?.resources ?? [];
    if (!resources.length) {
      console.log(`[discovery] No Bazaar results for: "${task.subQuestion}"`);
      return null;
    }

    // Filter to HTTP resources with a parseable URL, then rank cheapest first
    const candidates = resources
      .filter((r) => r.type === 'http' && r.resource?.startsWith('https://'))
      // Exclude Tavily x402 URL to avoid double-counting; it's always the fallback
      .filter((r) => r.resource !== TAVILY_X402_URL)
      .map((r) => ({
        url: r.resource,
        name: r.description?.slice(0, 60) ?? new URL(r.resource).hostname,
        priceUsd: extractPriceUsd(r),
        source: 'discovered' as const,
      }))
      .sort((a, b) => a.priceUsd - b.priceUsd);

    if (!candidates.length) return null;

    const chosen = candidates[0];
    console.log(
      `[discovery] Chose "${chosen.name}" at $${chosen.priceUsd.toFixed(4)} for: "${task.role}"`,
    );
    return chosen;
  } catch (err) {
    console.warn('[discovery] Bazaar query failed:', (err as Error).message);
    return null;
  }
}
