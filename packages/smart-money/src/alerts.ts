import { DISCLAIMER, MemeSignalLevel, WalletTier } from '@memecoinbot/shared';
import type { ConsensusEvent, MemeScoreBreakdown } from './types';
import type { RiskFlags } from './types';

export type SmartMoneyAlertPayload = {
  symbol: string;
  mint: string;
  overall: number;
  level: MemeSignalLevel;
  consensus: ConsensusEvent;
  liquidityUsd: number | null;
  trend5m: string;
  trend15m: string;
  volumeChangePct: number | null;
  holderGrowthPct: number | null;
  buySellRatio: number | null;
  risk: RiskFlags;
  breakdown?: MemeScoreBreakdown;
};

export function formatSmartMoneyAlert(payload: SmartMoneyAlertPayload): {
  title: string;
  body: string;
} {
  const liq =
    payload.liquidityUsd != null ? `$${Math.round(payload.liquidityUsd).toLocaleString()}` : 'n/a';
  const vol =
    payload.volumeChangePct != null
      ? `${payload.volumeChangePct > 0 ? '+' : ''}${payload.volumeChangePct.toFixed(0)}%`
      : 'n/a';
  const holders =
    payload.holderGrowthPct != null
      ? `${payload.holderGrowthPct > 0 ? '+' : ''}${payload.holderGrowthPct.toFixed(1)}%`
      : 'n/a';
  const ratio = payload.buySellRatio != null ? payload.buySellRatio.toFixed(1) : 'n/a';
  const body = [
    'SMART MONEY ALERT',
    '',
    `Token: $${payload.symbol}`,
    `Mint: ${payload.mint}`,
    `Smart Money Score: ${Math.round(payload.overall)}/100`,
    `Level: ${payload.level}`,
    `Wallets Buying: ${payload.consensus.independentWallets}`,
    `Tier A Wallets: ${payload.consensus.tierA}`,
    `Tier B Wallets: ${payload.consensus.tierB}`,
    `Liquidity: ${liq}`,
    `5m Trend: ${payload.trend5m}`,
    `15m Trend: ${payload.trend15m}`,
    `Volume: ${vol}`,
    `Holder Growth: ${holders}`,
    `Buy/Sell Ratio: ${ratio}`,
    `Risk: ${payload.risk.severity}`,
    '',
    `Reason: ${payload.consensus.reason}`,
    '',
    'Wallet buys are an input into analysis — not an automatic BUY.',
    '',
    DISCLAIMER,
  ].join('\n');
  return { title: `SMART MONEY ALERT $${payload.symbol}`, body };
}

export function dashboardStatus(tier: WalletTier, excluded: boolean): string {
  if (excluded) return 'Excluded';
  if (tier === WalletTier.A) return 'Elite';
  if (tier === WalletTier.B) return 'Strong';
  if (tier === WalletTier.C) return 'Developing';
  return 'Low Quality';
}
