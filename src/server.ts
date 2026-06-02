import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { runIntent, type ProgressUpdate } from './runIntent.js';
import { getWalletAddress } from './payment.js';
import * as ledger from './ledger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Streaming run endpoint using Server-Sent Events
app.get('/api/run', async (req, res) => {
  const intent = (req.query.intent as string | undefined)?.trim();
  const location = (req.query.location as string | undefined)?.trim() || undefined;
  if (!intent) {
    res.status(400).json({ error: 'intent query param required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runIntent(intent, (update: ProgressUpdate) => {
      send(update);
    }, location);
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
  } finally {
    res.write('data: {"type":"close"}\n\n');
    res.end();
  }
});

// Non-streaming POST endpoint (simpler for scripts/testing)
app.post('/api/run', async (req, res) => {
  const { intent } = req.body as { intent?: string };
  if (!intent?.trim()) {
    res.status(400).json({ error: 'intent field required in JSON body' });
    return;
  }

  try {
    const result = await runIntent(intent.trim());
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Status endpoint
app.get('/api/status', async (_req, res) => {
  const walletAddress = await getWalletAddress().catch(() => '(not initialized)');
  res.json({
    walletAddress,
    totalSpend: ledger.getTotalSpend(),
    maxSpend: ledger.getMaxSpend(),
    remainingBudget: ledger.getRemainingBudget(),
    entries: ledger.getEntries(),
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
