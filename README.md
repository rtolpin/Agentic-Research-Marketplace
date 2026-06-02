# Agentic Research Marketplace

An AI-powered research platform where autonomous agents collaborate to answer complex questions — funded by x402 micropayments on Base mainnet.

Ask a question like *"Should I expand my coffee business into Japan?"* and a team of specialized AI agents will plan, search, and synthesize a structured analysis with citations and actionable recommendations.

![Research Marketplace](https://img.shields.io/badge/Base-Mainnet-blue) ![Claude](https://img.shields.io/badge/Claude-Sonnet-purple) ![x402](https://img.shields.io/badge/x402-micropayments-green)

---

## Live Demo

### [https://agentic-research-marketplace-production.up.railway.app](https://agentic-research-marketplace-production.up.railway.app)

---

## How It Works

1. **Orchestrator** — Claude breaks your question into 3–5 focused research sub-tasks (e.g. Market Size, Regulatory Environment, Competitor Analysis)
2. **Worker Agents** — each agent runs targeted searches via Tavily (free dev key or paid x402 micropayments)
3. **Synthesis** — Claude reads all findings and writes a decision-ready analysis with inline citations, headers, and a clear recommendation

```
User Question
     │
     ▼
┌─────────────┐     plans tasks      ┌──────────────────┐
│  Orchestrator│ ──────────────────► │  Research Plan   │
│  (Claude AI) │                     │  3–5 sub-tasks   │
└─────────────┘                      └──────────────────┘
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                   ┌────────────┐      ┌────────────┐      ┌────────────┐
                   │  Worker 1  │      │  Worker 2  │      │  Worker N  │
                   │  Tavily/   │      │  Tavily/   │      │  Tavily/   │
                   │  x402      │      │  x402      │      │  x402      │
                   └────────────┘      └────────────┘      └────────────┘
                          │                   │                   │
                          └───────────────────┴───────────────────┘
                                              │
                                              ▼
                                   ┌─────────────────────┐
                                   │  Claude Synthesis   │
                                   │  AI Analysis +      │
                                   │  Recommendations    │
                                   └─────────────────────┘
```

---

## Features

- **Multi-agent planning** — Claude decomposes complex questions into parallel research threads
- **AI synthesis** — structured analysis with headers, bullet points, and inline citations
- **x402 micropayments** — optionally pay for search results on-chain via Coinbase's x402 protocol
- **CDP wallet** — server-managed EVM wallet on Base mainnet handles payments automatically
- **Service discovery** — optionally discover research services via x402 Bazaar (with Tavily fallback)
- **Spend controls** — configurable per-session spend cap (default $1.00 USDC)
- **Real-time streaming** — live progress via Server-Sent Events as agents work

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI / LLM | [Anthropic Claude](https://anthropic.com) (claude-sonnet-4-6) |
| Search | [Tavily](https://tavily.com) (free dev key or x402 paid) |
| Payments | [x402 protocol](https://x402.org) + [Coinbase CDP SDK](https://docs.cdp.coinbase.com) |
| Wallet | CDP Server-Managed EVM Wallet on Base |
| Backend | Node.js + Express + TypeScript |
| Frontend | Vanilla HTML/JS (no framework) |

---

## Getting Started

### Prerequisites

- Node.js 19+
- API keys (see below)

### 1. Clone & Install

```bash
git clone https://github.com/rtolpin/Agentic-Research-Marketplace.git
cd Agentic-Research-Marketplace
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Coinbase Developer Platform — portal.cdp.coinbase.com
CDP_API_KEY_ID=your-key-id
CDP_API_KEY_SECRET=your-key-secret
CDP_WALLET_SECRET=your-wallet-secret

# Anthropic — console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...

# Tavily — app.tavily.com (free tier: 1000 req/mo)
TAVILY_API_KEY=tvly-...
```

**Where to get each key:**
- **CDP keys** — [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com) → API Keys → Create (you get all three values at creation time; wallet secret is generated separately under Wallet API)
- **Anthropic** — [console.anthropic.com](https://console.anthropic.com) → API Keys
- **Tavily** — [app.tavily.com](https://app.tavily.com) → free account

### 3. Run

```bash
npm run dev      # development with live reload
npm start        # production
```

Open [http://localhost:3000](http://localhost:3000)

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `USE_X402` | `false` | `true` = pay for searches with USDC on-chain; `false` = use free Tavily key |
| `USE_DISCOVERY` | `false` | `true` = discover services via x402 Bazaar; `false` = always use Tavily |
| `MAX_AGENTS` | `5` | Max concurrent research agents (1–5) |
| `MAX_SPEND_USDC` | `1.00` | Per-session spend cap in USDC |
| `NETWORK` | `base-mainnet` | Chain for x402 payments |
| `PORT` | `3000` | HTTP server port |

### Enabling x402 Payments

Set `USE_X402=true` in `.env` and fund your CDP wallet with USDC on Base mainnet. The app will display your wallet address in the status bar — send a small amount of USDC there before running paid queries. The spend cap prevents runaway costs.

---

## Project Structure

```
src/
├── server.ts        # Express server, SSE streaming endpoint
├── runIntent.ts     # End-to-end orchestration pipeline
├── orchestrator.ts  # Claude planning + synthesis prompts
├── worker.ts        # Individual research agent execution
├── payment.ts       # CDP wallet + x402 paid fetch
├── discovery.ts     # x402 Bazaar service discovery
├── ledger.ts        # In-memory spend tracking
├── types.ts         # Shared TypeScript interfaces
└── scripts/
    └── testPayment.ts  # Standalone payment smoke test
public/
└── index.html       # Single-page frontend (streaming UI)
```

---

## Deployment

See [Railway](#deploy-to-railway) for one-click cloud deployment.

### Deploy to Railway

1. Fork this repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Select this repo
4. Add environment variables (same as `.env`) in Railway's Variables tab
5. Railway auto-detects Node.js and deploys — your live URL appears in the dashboard

A `railway.toml` is included for zero-config deployment.

---

## License

MIT
