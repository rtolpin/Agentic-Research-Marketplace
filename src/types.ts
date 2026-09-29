export interface ResearchTask {
  role: string;
  subQuestion: string;
  queries: string[];
}

export interface ServiceInfo {
  url: string;
  name: string;
  priceUsd: number;
  source: 'discovered' | 'default';
  category?: string;
}

export interface Finding {
  title: string;
  url: string;
  content: string;
  score?: number;
  /** Set when the text matched a prompt-injection pattern. */
  suspicious?: boolean;
}

export interface WorkerResult {
  taskIndex: number;
  task: ResearchTask;
  findings: Finding[];
  spend: number;
  queriesRun: number;
  txHashes: string[];
  serviceUsed: string;
  serviceSource: 'discovered' | 'default';
  findingsDropped: number;
  injectionFlags: number;
  error?: string;
}

export interface PaidCallResult {
  data: unknown;
  costUsd: number;
  txHash: string;
}

export interface LedgerEntry {
  workerId: string;
  service: string;
  costUsd: number;
  txHash: string;
  timestamp: number;
}

export interface IntentResult {
  intent: string;
  tasks: ResearchTask[];
  workerResults: WorkerResult[];
  answer: string;
  totalSpend: number;
  claudeCostUsd: number;
  walletAddress: string;
  guardrails: GuardrailReport;
}

/** What the guardrails did during a run, for logging, the UI and evals. */
export interface GuardrailReport {
  planIssues: string[];
  findingsDropped: number;
  injectionFlags: number;
  citationsKept: number;
  ungroundedCitations: string[];
  adviceNoticeAdded: boolean;
  synthesisStopReason: string | null;
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface TavilyResponse {
  results: TavilyResult[];
  answer?: string;
  query: string;
}
