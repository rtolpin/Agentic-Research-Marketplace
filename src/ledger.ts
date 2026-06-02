import type { LedgerEntry } from './types.js';

const MAX_SPEND_USDC = parseFloat(process.env.MAX_SPEND_USDC ?? '1.00');

let totalSpend = 0;
const entries: LedgerEntry[] = [];

export function canSpend(amount: number): boolean {
  return totalSpend + amount <= MAX_SPEND_USDC;
}

export function recordSpend(entry: LedgerEntry): void {
  entries.push(entry);
  totalSpend += entry.costUsd;
}

export function getTotalSpend(): number {
  return totalSpend;
}

export function getEntries(): LedgerEntry[] {
  return [...entries];
}

export function getMaxSpend(): number {
  return MAX_SPEND_USDC;
}

export function getRemainingBudget(): number {
  return Math.max(0, MAX_SPEND_USDC - totalSpend);
}

export function reset(): void {
  totalSpend = 0;
  entries.length = 0;
}
