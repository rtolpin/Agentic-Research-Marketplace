import 'dotenv/config';
import { CdpClient } from '@coinbase/cdp-sdk';
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { RunLedger } from './ledger.js';
import { authorizePayment, paymentScope, type RequirementsLike } from './guardrails/spend.js';
import type { PaidCallResult } from './types.js';

export const TAVILY_X402_URL = 'https://x402.tavily.com/search';
const TAVILY_FREE_URL = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = parseInt(process.env.SERVICE_TIMEOUT_MS ?? '20000', 10);

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

  // Spend guardrail: check the price the service actually asks for and reserve it
  // against the current run's ledger before anything is signed.
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    const decision = authorizePayment(selectedRequirements as unknown as RequirementsLike);
    if (!decision.ok) {
      console.warn(`[payment] Blocked: ${decision.reason}`);
      return { abort: true, reason: decision.reason };
    }
  });

  paidFetch = wrapFetchWithPayment(fetch, client);
  cachedPriceUsd = await _fetchTavilyPricing();
  return paidFetch as typeof fetch;
}

/**
 * Generic paid call — pays any x402 service URL (or free Tavily when USE_X402=false).
 * Checks the spend cap, pays (the payment hook enforces policy and reserves the
 * real price), decodes the receipt, records spend.
 */
export async function paidCall(
  serviceUrl: string,
  body: Record<string, unknown>,
  workerId: string,
  ledger: RunLedger,
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Tavily free API error ${res.status}: ${txt}`);
    }
    const data = await res.json();
    return { data, costUsd: 0, txHash: '' };
  }

  // Paid x402 path
  if (!ledger.canSpend(cachedPriceUsd)) {
    throw new Error(
      `Spend cap reached: $${ledger.getTotalSpend().toFixed(4)} of $${ledger.maxSpend} used`,
    );
  }

  const fetchFn = await _initPaymentClient();

  // A thrown error after a payment was signed keeps its reservation: we can't
  // tell whether it settled, so the caps stay conservative.
  const scope = { ledger, reservedUsd: 0 };
  const res = await paymentScope.run(scope, () => fetchFn(serviceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }));
  const header = res.headers.get('payment-response') ?? res.headers.get('PAYMENT-RESPONSE');

  if (!res.ok) {
    // No receipt means the service did not settle; give the reservation back.
    if (!header && scope.reservedUsd > 0) ledger.release(scope.reservedUsd);
    const txt = await res.text().catch(() => '');
    throw new Error(`x402 service error ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();

  // Decode the PAYMENT-RESPONSE receipt for the on-chain tx hash
  let txHash = '';
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

  const costUsd = scope.reservedUsd;
  ledger.commit({ workerId, service: serviceUrl, costUsd, txHash, timestamp: Date.now() });

  return { data, costUsd, txHash };
}

/**
 * Convenience wrapper: search via Tavily (x402 or free dev key).
 */
export async function paidSearch(
  query: string,
  params: Record<string, unknown> = {},
  workerId = 'unknown',
  ledger: RunLedger = new RunLedger(),
): Promise<PaidCallResult> {
  const useX402 = process.env.USE_X402 === 'true';
  const serviceUrl = useX402 ? TAVILY_X402_URL : TAVILY_FREE_URL;
  return paidCall(serviceUrl, { query, max_results: 5, include_answer: true, ...params }, workerId, ledger);
}
