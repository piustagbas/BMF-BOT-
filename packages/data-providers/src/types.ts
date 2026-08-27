export type ProviderKey =
  | 'dexscreener'
  | 'jupiter'
  | 'solana_rpc'
  | 'axiom'
  | 'token_security';

export interface ProviderResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  unavailable?: boolean;
}

export interface DexPairSnapshot {
  chainId: string;
  dexId: string;
  pairAddress: string;
  url?: string;
  imageUrl?: string | null;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  volumeM5?: number | null;
  volumeH1?: number | null;
  priceChange24h: number | null;
  priceChangeM5: number | null;
  priceChangeH1: number | null;
  priceChangeH6: number | null;
  buys24h: number | null;
  sells24h: number | null;
  buysM5?: number | null;
  sellsM5?: number | null;
  pairCreatedAt: number | null;
  pairAgeHours: number | null;
}

export interface TokenMarketSnapshot {
  address: string;
  name: string;
  symbol: string;
  imageUrl?: string | null;
  priceUsd: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  volumeM5?: number | null;
  volumeH1?: number | null;
  priceChange24h: number | null;
  priceChangeM5?: number | null;
  priceChangeH1?: number | null;
  priceChangeH6?: number | null;
  buys24h: number | null;
  sells24h: number | null;
  buysM5?: number | null;
  sellsM5?: number | null;
  pairAgeHours: number | null;
  dexId: string | null;
  pairAddress: string | null;
  source: 'dexscreener' | 'geckoterminal';
  fetchedAt: string;
}

export interface JupiterPriceQuote {
  mint: string;
  priceUsd: number | null;
  routeAvailable: boolean;
  raw?: unknown;
}

export interface JupiterSwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: number | null;
  routePlanLength: number;
  raw: Record<string, unknown>;
}

export interface JupiterSwapTransaction {
  swapTransaction: string;
  lastValidBlockHeight: number | null;
}

export interface SourceHealth {
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  message?: string;
  latencyMs?: number;
}

export interface PriceConsensus {
  dexscreenerPrice: number | null;
  jupiterPrice: number | null;
  conflict: boolean;
  conflictReason?: string;
  maxDeviationPct: number | null;
}
