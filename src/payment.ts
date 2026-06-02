import 'dotenv/config';
import { CdpClient } from '@coinbase/cdp-sdk';
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import * as ledger from './ledger.js';
import type { PaidCallResult } from './types.js';

export const TAVILY_X402_URL = 'https://x402.tavily.com/search';
const TAVILY_FREE_URL = 'https://api.tavily.com/search';

let paidFetch: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null = null;
let _walletAddress = '';
let cachedPriceUsd = 0.01;

export async function getWalletAddress(): Promise<string> {
  if (!_walletAddress) await _initPaymentClient();
  return _walletAddress;
}

async function _fetchTavilyPricing(): Promise<number> {
  try {
    const res = await fetch('https://x402.tavily.com/.well-known/pricing');
    if (!res.ok) return 0.01;
    const data = await res.json() as Record<string, unknown>;
    // pricing response format: array of { price, network, ... } or { POST: { price } }
    // Fall back to $0.01 if we can't parse a clear price
    const raw = JSON.stringify(data);
    const match = raw.match(/"(?:maxAmountRequired|price|amount)"\s*:\s*"?(\d+)"?/i);
    if (match) {
      const atomic = parseInt(match[1], 10);
      if (atomic > 0 && atomic < 1_000_000_000) return atomic / 1_000_000;
    }
    return 0.01;
  } catch {
    return 0.01;
  }
}

async function _initPaymentClient(): Promise<typeof fetch> {
  if (paidFetch) return paidFetch as typeof fetch;

  const cdp = new CdpClient();
  // getOrCreateAccount is idempotent — same name = same wallet across restarts
  const account = await cdp.evm.getOrCreateAccount({ name: 'research-treasury' });
  _walletAddress = account.address;

  // Adapt CDP EvmServerAccount to x402 ClientEvmSigner interface.
  // CDP accounts implement viem's signTypedData compatible signature;
  // toClientEvmSigner wraps it for the exact EVM payment scheme.
  const signer = toClientEvmSigner({
    address: account.address as `0x${string}`,
    signTypedData: (params) => account.signTypedData(params as Parameters<typeof account.signTypedData>[0]),
  });

  const client = new x402Client();
  registerExactEvmScheme(client, { signer });

  paidFetch = wrapFetchWithPayment(fetch, client);
  cachedPriceUsd = await _fetchTavilyPricing();
  return paidFetch as typeof fetch;
}

/**
 * Generic paid call — pays any x402 service URL (or free Tavily when USE_X402=false).
 * Checks the spend cap, pays, decodes the receipt, records spend.
 */
export async function paidCall(
  serviceUrl: string,
  body: Record<string, unknown>,
  workerId = 'unknown',
): Promise<PaidCallResult> {
  const useX402 = process.env.USE_X402 === 'true';

  if (!useX402) {
    // Free dev-key path — always hits Tavily regardless of serviceUrl
    const res = await fetch(TAVILY_FREE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Tavily free API error ${res.status}: ${txt}`);
    }
    const data = await res.json();
    return { data, costUsd: 0, txHash: '' };
  }

  // Paid x402 path
  const costUsd = cachedPriceUsd;
  if (!ledger.canSpend(costUsd)) {
    throw new Error(
      `Spend cap reached: $${ledger.getTotalSpend().toFixed(4)} of $${ledger.getMaxSpend()} used`,
    );
  }

  const fetchFn = await _initPaymentClient();

  const res = await fetchFn(serviceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`x402 service error ${res.status}: ${txt}`);
  }

  const data = await res.json();

  // Decode the PAYMENT-RESPONSE receipt for the on-chain tx hash
  let txHash = '';
  const header = res.headers.get('payment-response') ?? res.headers.get('PAYMENT-RESPONSE');
  if (header) {
    try {
      const receipt = decodePaymentResponseHeader(header);
      txHash = (receipt as Record<string, unknown>)?.transaction as string ?? '';
    } catch {
      try {
        const manual = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
        txHash = manual?.transaction ?? '';
      } catch { /* no tx hash */ }
    }
  }

  ledger.recordSpend({ workerId, service: serviceUrl, costUsd, txHash, timestamp: Date.now() });

  return { data, costUsd, txHash };
}

/**
 * Convenience wrapper: search via Tavily (x402 or free dev key).
 */
export async function paidSearch(
  query: string,
  params: Record<string, unknown> = {},
  workerId = 'unknown',
): Promise<PaidCallResult> {
  const useX402 = process.env.USE_X402 === 'true';
  const serviceUrl = useX402 ? TAVILY_X402_URL : TAVILY_FREE_URL;
  return paidCall(serviceUrl, { query, max_results: 5, include_answer: true, ...params }, workerId);
}
