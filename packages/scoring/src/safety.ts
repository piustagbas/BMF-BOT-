import {
  HolderRiskLevel,
  SAFETY_WEIGHTS,
  WhaleActivity,
} from '@memecoinbot/shared';

export type SafetyWeights = {
  tokenSecurity: number;
  liquidity: number;
  holderDistribution: number;
  tradingActivity: number;
  volumeQuality: number;
  developerActivity: number;
  tokenHistory: number;
};

export type SafetyComponentScores = {
  tokenSecurity: number;
  liquidity: number;
  holderDistribution: number;
  tradingActivity: number;
  volumeQuality: number;
  developerActivity: number;
  tokenHistory: number;
};

export type SafetyAnalysisInput = {
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  mutableMetadata?: boolean | null;
  liquidityUsd: number | null;
  minLiquidityUsd?: number;
  top10Pct: number | null;
  top20Pct: number | null;
  holderCount: number | null;
  buys24h: number | null;
  sells24h: number | null;
  volume24h: number | null;
  pairAgeHours: number | null;
  creatorBalancePct?: number | null;
  dangerRiskCount?: number;
  warnRiskCount?: number;
  criticalFlags?: string[];
  weights?: Partial<SafetyWeights>;
};

export type SafetyAnalysisResult = {
  safetyScore: number;
  components: SafetyComponentScores;
  weights: SafetyWeights;
  holderRisk: HolderRiskLevel;
  whaleActivity: WhaleActivity;
  criticalWarning: boolean;
  criticalReasons: string[];
  decision: 'POTENTIAL_SETUP' | 'NO_TRADE';
  summary: string;
};

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function mergeWeights(partial?: Partial<SafetyWeights>): SafetyWeights {
  const merged: SafetyWeights = {
    tokenSecurity: partial?.tokenSecurity ?? SAFETY_WEIGHTS.tokenSecurity,
    liquidity: partial?.liquidity ?? SAFETY_WEIGHTS.liquidity,
    holderDistribution:
      partial?.holderDistribution ?? SAFETY_WEIGHTS.holderDistribution,
    tradingActivity: partial?.tradingActivity ?? SAFETY_WEIGHTS.tradingActivity,
    volumeQuality: partial?.volumeQuality ?? SAFETY_WEIGHTS.volumeQuality,
    developerActivity:
      partial?.developerActivity ?? SAFETY_WEIGHTS.developerActivity,
    tokenHistory: partial?.tokenHistory ?? SAFETY_WEIGHTS.tokenHistory,
  };

  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...SAFETY_WEIGHTS };
  // normalize so weights always sum to 1
  return {
    tokenSecurity: merged.tokenSecurity / sum,
    liquidity: merged.liquidity / sum,
    holderDistribution: merged.holderDistribution / sum,
    tradingActivity: merged.tradingActivity / sum,
    volumeQuality: merged.volumeQuality / sum,
    developerActivity: merged.developerActivity / sum,
    tokenHistory: merged.tokenHistory / sum,
  };
}

export function classifyHolderRisk(
  top10Pct: number | null,
  top20Pct: number | null,
): HolderRiskLevel {
  const t10 = top10Pct ?? 100;
  const t20 = top20Pct ?? 100;
  if (t10 >= 70 || t20 >= 85) return HolderRiskLevel.CRITICAL;
  if (t10 >= 55 || t20 >= 75) return HolderRiskLevel.HIGH;
  if (t10 >= 40 || t20 >= 60) return HolderRiskLevel.MEDIUM;
  return HolderRiskLevel.LOW;
}

export function classifyWhaleActivity(input: {
  buys24h: number | null;
  sells24h: number | null;
  top10Pct: number | null;
  dangerRiskCount?: number;
}): WhaleActivity {
  const buys = input.buys24h ?? 0;
  const sells = input.sells24h ?? 0;
  const total = buys + sells;
  if ((input.dangerRiskCount ?? 0) >= 3 || (input.top10Pct ?? 0) >= 70) {
    return WhaleActivity.SUSPICIOUS;
  }
  if (total < 20) return WhaleActivity.NEUTRAL;
  const buyRatio = buys / total;
  if (buyRatio >= 0.62) return WhaleActivity.ACCUMULATION;
  if (buyRatio <= 0.38) return WhaleActivity.DISTRIBUTION;
  return WhaleActivity.NEUTRAL;
}

function scoreTokenSecurity(input: SafetyAnalysisInput): number {
  let score = 100;
  if (input.mintAuthorityRevoked === false) score -= 55;
  if (input.freezeAuthorityRevoked === false) score -= 40;
  if (input.mintAuthorityRevoked === null) score -= 15;
  if (input.freezeAuthorityRevoked === null) score -= 10;
  if (input.mutableMetadata === true) score -= 8;
  score -= Math.min(35, (input.dangerRiskCount ?? 0) * 12);
  score -= Math.min(15, (input.warnRiskCount ?? 0) * 4);
  return clampScore(score);
}

function scoreLiquidity(liquidityUsd: number | null, minLiquidityUsd: number): number {
  if (liquidityUsd === null) return 35;
  if (liquidityUsd >= minLiquidityUsd * 4) return 100;
  if (liquidityUsd >= minLiquidityUsd * 2) return 90;
  if (liquidityUsd >= minLiquidityUsd) return 80;
  if (liquidityUsd >= minLiquidityUsd * 0.5) return 55;
  if (liquidityUsd >= minLiquidityUsd * 0.2) return 30;
  return 10;
}

function scoreHolders(
  top10Pct: number | null,
  top20Pct: number | null,
  holderCount: number | null,
): number {
  const risk = classifyHolderRisk(top10Pct, top20Pct);
  let score =
    risk === HolderRiskLevel.LOW
      ? 90
      : risk === HolderRiskLevel.MEDIUM
        ? 65
        : risk === HolderRiskLevel.HIGH
          ? 35
          : 10;
  if (holderCount !== null) {
    if (holderCount >= 1000) score += 8;
    else if (holderCount >= 200) score += 4;
    else if (holderCount < 50) score -= 15;
  }
  return clampScore(score);
}

function scoreTradingActivity(buys24h: number | null, sells24h: number | null): number {
  if (buys24h === null || sells24h === null) return 40;
  const total = buys24h + sells24h;
  if (total <= 0) return 15;
  const buyRatio = buys24h / total;
  let score = 50;
  if (total >= 500) score += 25;
  else if (total >= 100) score += 15;
  else if (total >= 30) score += 8;
  else score -= 10;
  // balanced-to-slightly-buy-heavy is healthier than extreme one-sided
  if (buyRatio >= 0.4 && buyRatio <= 0.7) score += 15;
  else if (buyRatio > 0.85 || buyRatio < 0.2) score -= 20;
  return clampScore(score);
}

function scoreVolumeQuality(
  volume24h: number | null,
  liquidityUsd: number | null,
): number {
  if (volume24h === null) return 40;
  if (volume24h <= 0) return 10;
  let score = 50;
  if (volume24h >= 250_000) score += 30;
  else if (volume24h >= 50_000) score += 20;
  else if (volume24h >= 10_000) score += 10;
  else score -= 10;

  if (liquidityUsd && liquidityUsd > 0) {
    const turnover = volume24h / liquidityUsd;
    // extremely high turnover can indicate wash / fragile liquidity
    if (turnover > 50) score -= 25;
    else if (turnover > 20) score -= 10;
    else if (turnover >= 0.5 && turnover <= 8) score += 10;
  }
  return clampScore(score);
}

function scoreDeveloper(input: SafetyAnalysisInput): number {
  let score = 75;
  const creatorPct = input.creatorBalancePct;
  if (creatorPct === null || creatorPct === undefined) score -= 10;
  else if (creatorPct >= 20) score -= 45;
  else if (creatorPct >= 10) score -= 30;
  else if (creatorPct >= 5) score -= 15;
  else if (creatorPct <= 1) score += 15;
  score -= Math.min(20, (input.dangerRiskCount ?? 0) * 5);
  return clampScore(score);
}

function scoreHistory(pairAgeHours: number | null): number {
  if (pairAgeHours === null) return 45;
  if (pairAgeHours < 1) return 15;
  if (pairAgeHours < 6) return 35;
  if (pairAgeHours < 24) return 55;
  if (pairAgeHours < 72) return 70;
  if (pairAgeHours < 168) return 85;
  return 95;
}

export function computeSafetyScore(input: SafetyAnalysisInput): SafetyAnalysisResult {
  const weights = mergeWeights(input.weights);
  const minLiquidityUsd = input.minLiquidityUsd ?? 25_000;

  const components: SafetyComponentScores = {
    tokenSecurity: scoreTokenSecurity(input),
    liquidity: scoreLiquidity(input.liquidityUsd, minLiquidityUsd),
    holderDistribution: scoreHolders(
      input.top10Pct,
      input.top20Pct,
      input.holderCount,
    ),
    tradingActivity: scoreTradingActivity(input.buys24h, input.sells24h),
    volumeQuality: scoreVolumeQuality(input.volume24h, input.liquidityUsd),
    developerActivity: scoreDeveloper(input),
    tokenHistory: scoreHistory(input.pairAgeHours),
  };

  const weighted =
    components.tokenSecurity * weights.tokenSecurity +
    components.liquidity * weights.liquidity +
    components.holderDistribution * weights.holderDistribution +
    components.tradingActivity * weights.tradingActivity +
    components.volumeQuality * weights.volumeQuality +
    components.developerActivity * weights.developerActivity +
    components.tokenHistory * weights.tokenHistory;

  const safetyScore = clampScore(weighted);
  const holderRisk = classifyHolderRisk(input.top10Pct, input.top20Pct);
  const whaleActivity = classifyWhaleActivity({
    buys24h: input.buys24h,
    sells24h: input.sells24h,
    top10Pct: input.top10Pct,
    dangerRiskCount: input.dangerRiskCount,
  });

  const criticalReasons = [...(input.criticalFlags ?? [])];
  if (input.mintAuthorityRevoked === false) {
    criticalReasons.push('Mint authority is still active');
  }
  if (input.freezeAuthorityRevoked === false) {
    criticalReasons.push('Freeze authority is still active');
  }
  if (holderRisk === HolderRiskLevel.CRITICAL) {
    criticalReasons.push('Holder concentration is CRITICAL RISK');
  }

  const criticalWarning = criticalReasons.length > 0;
  const decision = criticalWarning ? 'NO_TRADE' : 'POTENTIAL_SETUP';

  const summary = criticalWarning
    ? `NO TRADE — critical security warning: ${criticalReasons[0]}`
    : `Potential setup — safety ${safetyScore}/100 (not a guarantee)`;

  return {
    safetyScore,
    components,
    weights,
    holderRisk,
    whaleActivity,
    criticalWarning,
    criticalReasons: [...new Set(criticalReasons)],
    decision,
    summary,
  };
}

