import 'dotenv/config';
import express, { type Request } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { runIntent, GuardrailBlockedError, RunAbortedError, type ProgressUpdate } from './runIntent.js';
import { getWalletAddress } from './payment.js';
import * as ledger from './ledger.js';
import { validateIntent, validateLocation } from './guardrails/input.js';
import { RateLimiter, ConcurrencyGate } from './guardrails/rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

const rateLimiter = new RateLimiter(
  parseInt(process.env.RATE_LIMIT_PER_HOUR ?? '20', 10),
  60 * 60 * 1000,
);
const runGate = new ConcurrencyGate(parseInt(process.env.MAX_CONCURRENT_RUNS ?? '3', 10));

// Railway terminates TLS at a proxy; trust it so req.ip is the client address.
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

type Admission =
  | { ok: true; intent: string; location?: string; release: () => void }
  | { ok: false; status: number; error: string; retryAfterSec?: number };

/**
 * Shared request guardrails for both run endpoints: input validation, per-IP rate
 * limit, and a global concurrency cap.
 */
function admitRun(req: Request, rawIntent: unknown, rawLocation: unknown): Admission {
  const intent = validateIntent(rawIntent);
  if (!intent.ok) return { ok: false, status: 400, error: intent.error };
  const location = validateLocation(rawLocation);
  if (location && !location.ok) return { ok: false, status: 400, error: location.error };

  const limit = rateLimiter.hit(req.ip ?? 'unknown');
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit reached. Try again in ${Math.ceil(limit.retryAfterSec / 60)} min.`,
      retryAfterSec: limit.retryAfterSec,
    };
  }

  const release = runGate.tryAcquire();
  if (!release) {
    return { ok: false, status: 503, error: 'Too many research runs in progress. Please try again shortly.', retryAfterSec: 30 };
  }

  return { ok: true, intent: intent.value, location: location?.value, release };
}

// Streaming run endpoint using Server-Sent Events
app.get('/api/run', async (req, res) => {
  const admitted = admitRun(req, req.query.intent, req.query.location);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // EventSource can't read HTTP error bodies, so rejections go over the stream
  if (!admitted.ok) {
    send({ type: 'error', message: admitted.error });
    res.end();
    return;
  }

  // Stop paying for searches once nobody is listening
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    await runIntent(admitted.intent, (update: ProgressUpdate) => {
      send(update);
    }, admitted.location, abort.signal);
  } catch (err) {
    if (err instanceof GuardrailBlockedError) {
      send({ type: 'blocked', message: err.message, category: err.category });
    } else if (err instanceof RunAbortedError) {
      console.log('[server] Client disconnected, run aborted');
    } else {
      console.error('[server] Run failed:', err);
      send({ type: 'error', message: 'The research run failed. Please try again.' });
    }
  } finally {
    admitted.release();
    res.write('data: {"type":"close"}\n\n');
    res.end();
  }
});

// Non-streaming POST endpoint (simpler for scripts/testing)
app.post('/api/run', async (req, res) => {
  const { intent, location } = (req.body ?? {}) as { intent?: unknown; location?: unknown };
  const admitted = admitRun(req, intent, location);
  if (!admitted.ok) {
    if (admitted.retryAfterSec) res.setHeader('Retry-After', String(admitted.retryAfterSec));
    res.status(admitted.status).json({ ok: false, error: admitted.error });
    return;
  }

  try {
    const result = await runIntent(admitted.intent, undefined, admitted.location);
    res.json({ ok: true, result });
  } catch (err) {
    if (err instanceof GuardrailBlockedError) {
      // A screen outage is retryable; a policy block is not
      const status = err.category === 'unavailable' ? 503 : 422;
      res.status(status).json({ ok: false, blocked: status === 422, category: err.category, error: err.message });
    } else {
      console.error('[server] Run failed:', err);
      res.status(500).json({ ok: false, error: 'The research run failed. Please try again.' });
    }
  } finally {
    admitted.release();
  }
});

// Status endpoint
app.get('/api/status', async (_req, res) => {
  const walletAddress = await getWalletAddress().catch(() => '(not initialized)');
  const lastRun = ledger.getLastRun();
  res.json({
    walletAddress,
    totalSpend: lastRun.getTotalSpend(),
    maxSpend: ledger.getMaxSpend(),
    remainingBudget: lastRun.getRemainingBudget(),
    dailySpend: ledger.getDailySpend(),
    maxDailySpend: ledger.getMaxDailySpend(),
    runsInFlight: runGate.inFlight,
    entries: lastRun.getEntries(),
    flags: {
      USE_X402: process.env.USE_X402 === 'true',
      USE_DISCOVERY: process.env.USE_DISCOVERY === 'true',
      MAX_AGENTS: process.env.MAX_AGENTS ?? '5',
      NETWORK: process.env.NETWORK ?? 'base-mainnet',
    },
  });
});

app.listen(PORT, () => {
  console.log(`\nResearch Marketplace running at http://localhost:${PORT}`);
  console.log(`USE_X402=${process.env.USE_X402}  USE_DISCOVERY=${process.env.USE_DISCOVERY}`);
  console.log(`MAX_AGENTS=${process.env.MAX_AGENTS ?? 5}  MAX_SPEND_USDC=${process.env.MAX_SPEND_USDC ?? 1.00}`);
});
