import { WalletTier } from '@memecoinbot/shared';
import type { DexTrade, ScoredWallet } from '@memecoinbot/smart-money';
import type { MemeSignalResult } from '@memecoinbot/smart-money';

export type DashboardWallet = {
  address: string;
  label: string;
  smartScore: number;
  tier: WalletTier;
  status: string;
  winRate: number;
  roi: number;
  averageHoldMin: number;
  earlyEntryScore: number;
  totalTrades: number;
  profitableCalls: number;
  realizedPnl: number;
  lastActive: string | null;
  confidenceScore: number;
  excluded: boolean;
  excludeReasons: string[];
  influence: number;
  windows: { last24h: number; last7d: number; last30d: number; allTime: number };
};

export type StoredMemeSignal = {
  token: string;
  symbol: string;
  overallScore: number;
  smartMoneyScore: number;
  numberOfSmartWallets: number;
  tierAWallets: number;
  tierBWallets: number;
  liquidityScore: number;
  volumeScore: number;
  holderScore: number;
  technicalScore: number;
  riskScore: number;
  signal: string;
  reason: string;
  timestamp: string;
};

export class SmartMoneyMemoryStore {
  wallets = new Map<string, DashboardWallet>();
  scored = new Map<string, ScoredWallet>();
  trades: DexTrade[] = [];
  signals: StoredMemeSignal[] = [];
  lastCycle: string | null = null;
  lastError: string | null = null;

  upsertTrades(trades: DexTrade[]): number {
    const seen = new Set(this.trades.map((t) => `${t.txHash}:${t.wallet}:${t.type}:${t.token}`));
    let added = 0;
    for (const t of trades) {
      const key = `${t.txHash}:${t.wallet}:${t.type}:${t.token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.trades.push(t);
      added += 1;
    }
    if (this.trades.length > 25_000) {
      this.trades = this.trades.slice(-20_000);
    }
    return added;
  }

  tradesForWallet(address: string): DexTrade[] {
    return this.trades.filter((t) => t.wallet === address);
  }

  recentBuys(token: string, sinceMs = 30 * 60_000): DexTrade[] {
    const from = Date.now() - sinceMs;
    return this.trades.filter(
      (t) => t.token === token && t.type === 'buy' && t.timestamp >= from,
    );
  }

  pushSignal(result: MemeSignalResult, token: string, symbol: string) {
    const row: StoredMemeSignal = {
      token,
      symbol,
      overallScore: result.overall,
      smartMoneyScore: result.breakdown.smartMoney,
      numberOfSmartWallets: result.consensus?.independentWallets ?? 0,
      tierAWallets: result.consensus?.tierA ?? 0,
      tierBWallets: result.consensus?.tierB ?? 0,
      liquidityScore: result.breakdown.liquidity,
      volumeScore: result.breakdown.volume,
      holderScore: result.breakdown.holders,
      technicalScore: result.breakdown.technical5m,
      riskScore: result.breakdown.risk,
      signal: result.level,
      reason: result.reason,
      timestamp: new Date().toISOString(),
    };
    this.signals.unshift(row);
    if (this.signals.length > 200) this.signals.length = 200;
  }
}
