import type { RiskFlags } from './types';

export type RiskDetectorInput = {
  top10Pct: number | null;
  topHolderIsCreator?: boolean;
  creatorBalancePct?: number | null;
  liquidityUsd: number | null;
  prevLiquidityUsd?: number | null;
  volume24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  uniqueTraders?: number | null;
  clusteredBuyShare?: number | null;
  slippageBps?: number | null;
  honeypot?: boolean | null;
  mintAuthorityActive?: boolean | null;
  freezeAuthorityActive?: boolean | null;
  smartMoneyNetSelling?: boolean;
  dangerRiskCount?: number;
};

export function detectRisk(input: RiskDetectorInput): RiskFlags {
  const reasons: string[] = [];
  const concentratedOwnership = (input.top10Pct ?? 0) >= 55;
  if (concentratedOwnership) reasons.push('Extremely concentrated ownership');

  const devDumping =
    Boolean(input.topHolderIsCreator) || (input.creatorBalancePct ?? 0) > 12;
  if (devDumping) reasons.push('Creator / dev still holds a large share');

  const prev = input.prevLiquidityUsd;
  const liq = input.liquidityUsd;
  const liquidityRemoved =
    prev != null && liq != null && prev > 0 && liq / prev < 0.45;
  if (liquidityRemoved) reasons.push('Sudden liquidity removal');

  const liquidityCollapse = liq != null && liq < 8_000;
  if (liquidityCollapse) reasons.push('Liquidity collapse / thin pool');

  const tx = (input.buys24h ?? 0) + (input.sells24h ?? 0);
  const traders = input.uniqueTraders ?? null;
  const washTrading =
    tx >= 400 &&
    (traders != null ? traders < 20 : false) &&
    (input.volume24h ?? 0) > (liq ?? 1) * 12;
  if (washTrading) reasons.push('Volume looks artificial vs unique traders');

  const bundledWallets = (input.clusteredBuyShare ?? 0) >= 0.45;
  if (bundledWallets) reasons.push('Bundled / clustered wallets dominate buys');

  const coordinatedBuying = bundledWallets && (input.clusteredBuyShare ?? 0) >= 0.6;
  if (coordinatedBuying) reasons.push('Suspicious coordinated buying');

  const highSlippage = (input.slippageBps ?? 0) >= 800;
  if (highSlippage) reasons.push('Extremely high slippage');

  const honeypot = Boolean(input.honeypot) || (input.dangerRiskCount ?? 0) >= 2;
  if (honeypot) reasons.push('Honeypot / transfer restriction risk');

  const authorityRisk =
    Boolean(input.mintAuthorityActive) || Boolean(input.freezeAuthorityActive);
  if (authorityRisk) reasons.push('Mint or freeze authority still active');

  const smartMoneySelling = Boolean(input.smartMoneyNetSelling);
  if (smartMoneySelling) reasons.push('Tracked smart money is selling');

  const highHits = [
    concentratedOwnership && (input.top10Pct ?? 0) >= 70,
    liquidityRemoved,
    honeypot,
    authorityRisk,
    liquidityCollapse,
  ].filter(Boolean).length;

  const severity: RiskFlags['severity'] =
    highHits >= 1 || reasons.length >= 4 ? 'HIGH' : reasons.length >= 2 ? 'MEDIUM' : 'LOW';

  return {
    concentratedOwnership,
    devDumping,
    liquidityRemoved,
    washTrading,
    bundledWallets,
    coordinatedBuying,
    highSlippage,
    honeypot,
    authorityRisk,
    smartMoneySelling,
    liquidityCollapse,
    reasons,
    severity,
  };
}

export function riskToScore(flags: RiskFlags): number {
  if (flags.honeypot || flags.liquidityRemoved || flags.liquidityCollapse) return 8;
  if (flags.severity === 'HIGH') return 22;
  if (flags.severity === 'MEDIUM') return 48;
  if (flags.reasons.length) return 68;
  return 86;
}
