import type { LedgerEntry } from './types.js';

const MAX_SPEND_USDC = parseFloat(process.env.MAX_SPEND_USDC ?? '1.00');
const MAX_DAILY_SPEND_USDC = parseFloat(process.env.MAX_DAILY_SPEND_USDC ?? '10.00');

/**
 * Process-wide daily spend tally (UTC day). Backstops the per-run cap so a
 * public endpoint can't drain the wallet through many small runs.
 * In-memory: resets on restart and is per-process.
 */
const daily = { day: '', spent: 0 };

function dailySpent(now = new Date()): number {
  const day = now.toISOString().slice(0, 10);
  if (daily.day !== day) {
    daily.day = day;
    daily.spent = 0;
  }
  return daily.spent;
}

/**
 * Per-run spend ledger. Each request gets its own instance so concurrent runs
 * can't reset or consume each other's budgets.
 *
 * Spend is reserved before a payment is signed and released only if the
 * service did not settle, so caps hold even when calls overlap.
 */
export class RunLedger {
  private totalSpend = 0;
  private readonly entries: LedgerEntry[] = [];

  constructor(
    readonly maxSpend = MAX_SPEND_USDC,
    readonly maxDailySpend = MAX_DAILY_SPEND_USDC,
  ) {}

  canSpend(amount: number): boolean {
    return this.totalSpend + amount <= this.maxSpend + 1e-9
      && dailySpent() + amount <= this.maxDailySpend + 1e-9;
  }

  /** Atomically reserves `amount` against both caps. Returns false if either would be exceeded. */
  reserve(amount: number): boolean {
    if (!this.canSpend(amount)) return false;
    this.totalSpend += amount;
    daily.spent += amount;
    return true;
  }

  release(amount: number): void {
    this.totalSpend = Math.max(0, this.totalSpend - amount);
    daily.spent = Math.max(0, daily.spent - amount);
  }

  /** Records a settled payment that was previously reserved. */
  commit(entry: LedgerEntry): void {
    this.entries.push(entry);
  }

  getTotalSpend(): number {
    return this.totalSpend;
  }

  getEntries(): LedgerEntry[] {
    return [...this.entries];
  }

  getRemainingBudget(): number {
    return Math.max(0, this.maxSpend - this.totalSpend);
  }
}

let lastRun = new RunLedger();

/** Creates the ledger for a new run and makes it the one reported by /api/status. */
export function startRun(): RunLedger {
  lastRun = new RunLedger();
  return lastRun;
}

export function getLastRun(): RunLedger {
  return lastRun;
}

export function getMaxSpend(): number {
  return MAX_SPEND_USDC;
}

export function getDailySpend(): number {
  return dailySpent();
}

export function getMaxDailySpend(): number {
  return MAX_DAILY_SPEND_USDC;
}

/** Test hook. */
export function resetDaily(): void {
  daily.day = '';
  daily.spent = 0;
}
