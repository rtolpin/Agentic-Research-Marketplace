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
}

export interface Finding {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface WorkerResult {
  taskIndex: number;
  task: ResearchTask;
  findings: Finding[];
  spend: number;
  txHashes: string[];
  serviceUsed: string;
  serviceSource: 'discovered' | 'default';
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
  walletAddress: string;
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
