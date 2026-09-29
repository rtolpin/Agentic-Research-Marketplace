import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunLedger } from '../ledger.js';

// USDC on Base mainnet (6 decimals). Prices are only converted correctly for this asset.
export const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const BASE_NETWORKS = ['eip155:8453', 'base'];

const MAX_PRICE_PER_CALL_USDC = parseFloat(process.env.MAX_PRICE_PER_CALL_USDC ?? '0.05');

export interface PaymentPolicy {
  maxPerCallUsd: number;
  allowedNetworks: string[];
  allowedAssets: string[];
}

export const DEFAULT_POLICY: PaymentPolicy = {
  maxPerCallUsd: MAX_PRICE_PER_CALL_USDC,
  allowedNetworks: BASE_NETWORKS,
  allowedAssets: [BASE_USDC],
};

/** Subset of x402 PaymentRequirements (v1 uses maxAmountRequired, v2 uses amount). */
export interface RequirementsLike {
  network: string;
  asset: string;
  amount?: string;
  maxAmountRequired?: string;
}

export type PaymentDecision =
  | { ok: true; amountUsd: number }
  | { ok: false; reason: string };

/**
 * Checks what a service is actually asking to be paid, before anything is signed.
 * Discovered Bazaar services set their own prices, so the advertised price is not trusted.
 */
export function evaluatePayment(req: RequirementsLike, policy: PaymentPolicy = DEFAULT_POLICY): PaymentDecision {
  if (!policy.allowedNetworks.includes(req.network)) {
    return { ok: false, reason: `network ${req.network} not allowed` };
  }
  if (!policy.allowedAssets.includes(String(req.asset).toLowerCase())) {
    return { ok: false, reason: `asset ${req.asset} not allowed` };
  }
  const raw = req.amount ?? req.maxAmountRequired;
  if (raw === undefined || !/^\d+$/.test(String(raw))) {
    return { ok: false, reason: `unparseable amount ${raw}` };
  }
  const amountUsd = Number(BigInt(raw)) / 1_000_000;
  if (amountUsd <= 0) return { ok: false, reason: 'zero amount' };
  if (amountUsd > policy.maxPerCallUsd) {
    return { ok: false, reason: `price $${amountUsd.toFixed(4)} exceeds per-call max $${policy.maxPerCallUsd}` };
  }
  return { ok: true, amountUsd };
}

/** Context for one paid call, so the x402 payment hook can charge the right run's ledger. */
export interface PaymentScope {
  ledger: RunLedger;
  reservedUsd: number;
}

export const paymentScope = new AsyncLocalStorage<PaymentScope>();

/**
 * x402 onBeforePaymentCreation hook body. Fails closed: a payment attempted
 * outside a scope, off-policy, or over budget is aborted before signing.
 */
export function authorizePayment(req: RequirementsLike, policy: PaymentPolicy = DEFAULT_POLICY): PaymentDecision {
  const scope = paymentScope.getStore();
  if (!scope) return { ok: false, reason: 'payment attempted outside a run' };

  const decision = evaluatePayment(req, policy);
  if (!decision.ok) return decision;

  if (!scope.ledger.reserve(decision.amountUsd)) {
    return { ok: false, reason: `spend cap reached ($${scope.ledger.getTotalSpend().toFixed(4)} of $${scope.ledger.maxSpend})` };
  }
  scope.reservedUsd += decision.amountUsd;
  return decision;
}
