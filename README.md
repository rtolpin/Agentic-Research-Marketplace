# Agentic Research Marketplace

An AI-powered research platform where autonomous agents collaborate to answer complex questions — funded by x402 micropayments on Base mainnet.

Ask a question like *"Should I expand my coffee business into Japan?"* and a team of specialized AI agents will plan, search, and synthesize a structured analysis with citations and actionable recommendations.

![Research Marketplace](https://img.shields.io/badge/Base-Mainnet-blue) ![Claude](https://img.shields.io/badge/Claude-Sonnet-purple) ![x402](https://img.shields.io/badge/x402-micropayments-green)

---

## Live Demo

### [https://agentic-research-marketplace-production.up.railway.app](https://agentic-research-marketplace-production.up.railway.app)

---

## Example Queries

These questions are designed to showcase multi-agent decomposition — each spawns 3–5 specialized research agents working in parallel:

| Query | Agents spawned |
|---|---|
| *Should I expand my coffee business into Japan?* | Market size · Competitor landscape · Regulatory/import rules · Consumer preferences · Entry costs |
| *Is it a good time to invest in electric vehicle stocks?* | EV market trends · Key players & financials · Government policy · Supply chain risks · Analyst outlook |
| *Should I leave my corporate job to start a fintech startup?* | Fintech funding climate · Regulatory barriers · Competitor landscape · Founder success rates · Personal runway |
| *AWS, GCP, or Azure for an early-stage AI startup?* | Pricing comparison · AI/ML tooling · Startup credits · Migration complexity · Support quality |
| *Where can I buy my father a nice suit and tie in New York City?* | Top menswear stores · Price ranges · Tailoring options · Neighbourhood guide *(location-aware)* |
| *Is it better to buy or rent in Miami right now?* | Housing market data · Price-to-rent ratios · Mortgage outlook · Neighbourhood trends · Tax implications |
| *Should I build my app's backend in Go or Rust?* | Performance benchmarks · Talent pool · Ecosystem & libraries · Learning curve · Industry adoption |
| *What are the key risks of launching a food delivery startup in Chicago?* | Market saturation · Unit economics · Labour/regulatory laws · Incumbent moats · Consumer demand |

> **Tip:** Click **Detect my location** before searching for local queries (shopping, restaurants, real estate) to get geographically relevant results.

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
| `MAX_AGENTS` | `5` | Max research agents per query (1–5) |
| `MAX_QUERIES_PER_WORKER` | `2` | Max searches per agent (1–5) |
| `MAX_SPEND_USDC` | `1.00` | Per-session USDC spend cap |
| `NETWORK` | `base-mainnet` | Chain for x402 payments |
| `PORT` | `3000` | HTTP server port |

### Marketplace Modes

| Mode | Config | How it works |
|---|---|---|
| **Dev** | `USE_X402=false` | Free Tavily dev key — no wallet needed |
| **Paid** | `USE_X402=true` | Pays Tavily ~$0.01/search via x402 micropayment on Base |
| **Full Marketplace** | `USE_X402=true` + `USE_DISCOVERY=true` | Each agent queries the x402 Bazaar to find the cheapest available API for its sub-task, paying autonomously. Falls back to Tavily if nothing is found. |

In **Full Marketplace** mode, agents can discover and pay *different specialized services* per sub-task — a finance API for market data, a legal database for regulations, an academic API for research papers — each paid peer-to-peer with no accounts or subscriptions. This is the core vision of the agentic payments marketplace.

### Enabling x402 Payments

Set `USE_X402=true` and fund your CDP wallet with USDC on Base mainnet. The wallet address is shown in the status bar — send a small amount of USDC before running paid queries. The spend cap prevents runaway costs.

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
