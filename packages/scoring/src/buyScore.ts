import {
  BUY_SCORE_WEIGHTS,
  DEFAULT_RISK,
  MASTER_STRATEGY,
  SignalType,
} from '@memecoinbot/shared';
import type { CandlestickStructure } from '@memecoinbot/indicators';
import { evaluateBuyGates, pickSignalType, type TradeLevels } from './signal';

export type BuyScoreWeights = {
  safety: number;
  technical: number;
  momentum: number;
  candlestick: number;
  smartMoney: number;
  social: number;
  fomoQuality: number;
};

export type BuyScoreComponents = {
  safety: number;
  technical: number;
  momentum: number;
  candlestick: number;
  smartMoney: number | null;
  social: number;
  fomoQuality: number;
};

export type FomoPumpResult = {
  fomoScore: number;
  pumpScore: number;
  extremeFomo: boolean;
  highRiskPump: boolean;
  notes: string[];
};

export type SocialSentimentResult = {
  score: number;
  available: boolean;
  notes: string[];
};

export type SmartMoneyScoreInput = {
  available: boolean;
  walletsChecked: number;
  holders: number;
  score: number | null;
  notes: string[];
};

export type IndependentSignal = {
  key: 'technical' | 'momentum' | 'candlestick' | 'smartMoney' | 'social';
  label: string;
  score: number | null;
  agrees: boolean;
  available: boolean;
  detail: string;
};

export type WhyNotBuyItem = {
  key: string;
  label: string;
  passed: boolean;
  blocking: boolean;
  status: 'PASS' | 'FAIL' | 'NEUTRAL';
  value: string;
  detail: string;
  whyItMatters: string;
};

export type WhyNotBuyPanel = {
  title: 'Why Not Buy' | 'Why This Passed';
  decision: string;
  buyScore: number;
  safetyScore: number;
  agreeing: number;
  required: number;
  available: number;
  summary: string;
  items: WhyNotBuyItem[];
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function mergeBuyWeights(partial?: Partial<BuyScoreWeights>): BuyScoreWeights {
  const merged: BuyScoreWeights = {
    safety: partial?.safety ?? BUY_SCORE_WEIGHTS.safety,
    technical: partial?.technical ?? BUY_SCORE_WEIGHTS.technical,
    momentum: partial?.momentum ?? BUY_SCORE_WEIGHTS.momentum,
    candlestick: partial?.candlestick ?? BUY_SCORE_WEIGHTS.candlestick,
    smartMoney: partial?.smartMoney ?? BUY_SCORE_WEIGHTS.smartMoney,
    social: partial?.social ?? BUY_SCORE_WEIGHTS.social,
    fomoQuality: partial?.fomoQuality ?? BUY_SCORE_WEIGHTS.fomoQuality,
  };
  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...BUY_SCORE_WEIGHTS };
  return {
    safety: merged.safety / sum,
    technical: merged.technical / sum,
    momentum: merged.momentum / sum,
    candlestick: merged.candlestick / sum,
    smartMoney: merged.smartMoney / sum,
    social: merged.social / sum,
    fomoQuality: merged.fomoQuality / sum,
  };
}

export function scoreSocialSentiment(input: {
  buys24h: number | null;
  sells24h: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  marketCap: number | null;
  priceChangeH1: number | null;
  priceChange24h: number | null;
}): SocialSentimentResult {
  const notes: string[] = [];
  let score = 50;
  const buys = input.buys24h;
  const sells = input.sells24h;

  if (buys != null && sells != null && buys + sells > 0) {
    const ratio = buys / Math.max(sells, 1);
    if (ratio >= 1.4) {
      score += 16;
      notes.push(`Buy pressure ${ratio.toFixed(2)}x sells`);
    } else if (ratio >= 1.1) {
      score += 8;
      notes.push('Mild buy bias');
    } else if (ratio <= 0.65) {
      score -= 18;
      notes.push('Sell pressure dominates');
    } else {
      notes.push('Balanced flow');
    }
  } else {
    notes.push('Buy/sell flow unavailable');
  }

  const h1 = input.priceChangeH1;
  if (h1 != null) {
    if (h1 >= 3 && h1 <= 18) {
      score += 10;
      notes.push(`Constructive 1h ${h1.toFixed(1)}%`);
    } else if (h1 > 30) {
      score -= 8;
      notes.push('1h move is overheated');
    } else if (h1 < -12) {
      score -= 12;
      notes.push('1h dump');
    }
  }

  const vol = input.volume24h;
  const liq = input.liquidityUsd;
  if (vol != null && liq != null && liq > 0) {
    const churn = vol / liq;
    if (churn >= 0.6 && churn <= 5) {
      score += 8;
      notes.push('Healthy volume vs liquidity');
    } else if (churn > 12) {
      score -= 10;
      notes.push('Volume looks manic vs liquidity');
    }
  }

  const mcap = input.marketCap;
  if (vol != null && mcap != null && mcap > 0) {
    const turn = vol / mcap;
    if (turn >= 0.15 && turn <= 1.5) {
      score += 6;
    }
  }

  return {
    score: clamp(score),
    available: true,
    notes: notes.length ? notes : ['Neutral market-implied sentiment'],
  };
}

export function scoreFomoPump(input: {
  priceChangeM5: number | null;
  priceChangeH1: number | null;
  priceChange24h: number | null;
  pairAgeHours: number | null;
  rsi: number | null;
  volumeExpansion: boolean;
  volume24h: number | null;
  liquidityUsd: number | null;
}): FomoPumpResult {
  const notes: string[] = [];
  let fomo = 0;
  let pump = 0;

  const m5 = input.priceChangeM5;
  const h1 = input.priceChangeH1;
  const d1 = input.priceChange24h;

  if (m5 != null && m5 >= 12) {
    fomo += 28;
    notes.push(`Parabolic 5m (${m5.toFixed(1)}%)`);
  } else if (m5 != null && m5 >= 6) {
    fomo += 12;
    notes.push(`Hot 5m (${m5.toFixed(1)}%)`);
  }

  if (h1 != null && h1 >= 35) {
    fomo += 24;
    pump += 18;
    notes.push(`Vertical 1h (${h1.toFixed(1)}%)`);
  } else if (h1 != null && h1 >= 18) {
    fomo += 12;
    notes.push(`Strong 1h (${h1.toFixed(1)}%)`);
  }

  if (d1 != null && d1 >= 150) {
    fomo += 18;
    pump += 22;
    notes.push(`Extended 24h (${d1.toFixed(0)}%)`);
  } else if (d1 != null && d1 >= 80) {
    fomo += 14;
    pump += 12;
    notes.push(`Large 24h (${d1.toFixed(0)}%)`);
  }

  const age = input.pairAgeHours;
  if (age != null && age < 2) {
    pump += 24;
    fomo += 10;
    notes.push('Brand-new pair');
  } else if (age != null && age < 8) {
    pump += 12;
    notes.push('Very young pair');
  }

  if (input.rsi != null && input.rsi >= 80) {
    fomo += 20;
    notes.push(`RSI ${input.rsi.toFixed(0)} exhaustion`);
  } else if (input.rsi != null && input.rsi >= 72 && input.volumeExpansion) {
    fomo += 12;
    notes.push('Overbought with volume spike');
  }

  const vol = input.volume24h;
  const liq = input.liquidityUsd;
  if (vol != null && liq != null && liq > 0 && vol / liq >= 15) {
    pump += 18;
    fomo += 10;
    notes.push('Volume dwarfs liquidity');
  }

  const fomoScore = clamp(fomo);
  const pumpScore = clamp(pump);
  return {
    fomoScore,
    pumpScore,
    extremeFomo: fomoScore >= MASTER_STRATEGY.fomoExtremeMin,
    highRiskPump:
      pumpScore >= MASTER_STRATEGY.pumpRiskMin &&
      (fomoScore >= 55 || (age != null && age < 8) || (d1 != null && d1 >= 80)),
    notes: notes.length ? notes : ['No extreme FOMO / pump flags'],
  };
}

export function scoreSmartMoneyFromHoldings(input: {
  walletsChecked: number;
  holders: number;
  unavailable?: boolean;
  labels?: string[];
}): SmartMoneyScoreInput {
  if (input.unavailable || input.walletsChecked <= 0) {
    return {
      available: false,
      walletsChecked: input.walletsChecked,
      holders: 0,
      score: null,
      notes: ['No smart money wallets to check — discovery is still warming up'],
    };
  }
  const holders = Math.max(0, input.holders);
  if (holders <= 0) {
    return {
      available: true,
      walletsChecked: input.walletsChecked,
      holders: 0,
      score: 28,
      notes: [
        `0/${input.walletsChecked} tracked wallets hold this token`,
        'A wallet holding a token is not a BUY by itself.',
      ],
    };
  }
  const score = clamp(58 + Math.min(holders, 6) * 8);
  const names = input.labels?.slice(0, 3).join(', ');
  return {
    available: true,
    walletsChecked: input.walletsChecked,
    holders,
    score,
    notes: [
      `${holders}/${input.walletsChecked} tracked wallets hold this token` +
        (names ? ` (${names})` : ''),
      'Smart-money holdings are one input into the score, not an automatic BUY.',
    ],
  };
}

/** Quality-weighted consensus. Multiple independent A/B wallets beat a single whale. */
export function scoreSmartMoneyFromConsensus(input: {
  available: boolean;
  independent: number;
  tierA: number;
  tierB: number;
  strength: number | null;
  reason?: string;
}): SmartMoneyScoreInput {
  if (!input.available || input.strength == null) {
    return {
      available: false,
      walletsChecked: input.independent,
      holders: 0,
      score: null,
      notes: ['No independent smart-money consensus yet'],
    };
  }
  return {
    available: true,
    walletsChecked: input.independent,
    holders: input.independent,
    score: clamp(input.strength),
    notes: [
      input.reason ??
        `${input.independent} independent wallets (${input.tierA} Tier A, ${input.tierB} Tier B)`,
      'Consensus is one component of the overall score — never copy-trade blindly.',
    ],
  };
}

export function computeBuyScore(input: {
  components: BuyScoreComponents;
  weights?: Partial<BuyScoreWeights>;
}): { buyScore: number; weights: BuyScoreWeights; usedSmartMoney: boolean } {
  const base = mergeBuyWeights(input.weights);
  const usedSmartMoney = input.components.smartMoney != null;
  const active: Array<[keyof BuyScoreWeights, number]> = [
    ['safety', input.components.safety],
    ['technical', input.components.technical],
    ['momentum', input.components.momentum],
    ['candlestick', input.components.candlestick],
    ['social', input.components.social],
    ['fomoQuality', input.components.fomoQuality],
  ];
  if (usedSmartMoney) {
    active.push(['smartMoney', input.components.smartMoney as number]);
  }

  let weightSum = 0;
  for (const [key] of active) weightSum += base[key];
  if (weightSum <= 0) {
    return { buyScore: 0, weights: base, usedSmartMoney };
  }

  let acc = 0;
  const weights = { ...base };
  for (const key of Object.keys(base) as Array<keyof BuyScoreWeights>) {
    weights[key] = 0;
  }
  for (const [key, value] of active) {
    const w = base[key] / weightSum;
    weights[key] = w;
    acc += value * w;
  }

  return { buyScore: clamp(acc), weights, usedSmartMoney };
}

export function collectIndependentSignals(params: {
  technical: number;
  momentum: number;
  candlestick: number;
  smartMoney: number | null;
  social: number;
  agreeMin?: number;
  smartMoneyDetail?: string;
}): IndependentSignal[] {
  const min = params.agreeMin ?? MASTER_STRATEGY.componentAgreeMin;
  const rows: IndependentSignal[] = [
    {
      key: 'technical',
      label: 'Technical analysis',
      score: params.technical,
      available: true,
      agrees: params.technical >= min,
      detail: `TA ${Math.round(params.technical)}/100`,
    },
    {
      key: 'momentum',
      label: 'Momentum',
      score: params.momentum,
      available: true,
      agrees: params.momentum >= min,
      detail: `Momentum ${Math.round(params.momentum)}/100`,
    },
    {
      key: 'candlestick',
      label: 'Candlestick structure',
      score: params.candlestick,
      available: true,
      agrees: params.candlestick >= min,
      detail: `Candles ${Math.round(params.candlestick)}/100`,
    },
    {
      key: 'smartMoney',
      label: 'Smart money wallets',
      score: params.smartMoney,
      available: params.smartMoney != null,
      agrees: params.smartMoney != null && params.smartMoney >= min,
      detail:
        params.smartMoney == null
          ? params.smartMoneyDetail ??
            'No smart-money data yet — not the same as “wallets skipped this coin”'
          : params.smartMoneyDetail ?? `Smart money ${Math.round(params.smartMoney)}/100`,
    },
    {
      key: 'social',
      label: 'Social / flow sentiment',
      score: params.social,
      available: true,
      agrees: params.social >= min,
      detail: `Sentiment ${Math.round(params.social)}/100`,
    },
  ];
  return rows;
}

function item(
  key: string,
  label: string,
  passed: boolean,
  blocking: boolean,
  value: string,
  detail: string,
  whyItMatters: string,
  neutral = false,
): WhyNotBuyItem {
  return {
    key,
    label,
    passed,
    blocking,
    status: neutral ? 'NEUTRAL' : passed ? 'PASS' : 'FAIL',
    value,
    detail,
    whyItMatters,
  };
}

export function buildWhyNotBuyPanel(params: {
  canBuy: boolean;
  signalType: SignalType;
  safetyScore: number;
  buyScore: number;
  safetyMin: number;
  signalMin: number;
  liquidityUsd: number | null;
  minLiquidityUsd: number;
  criticalWarning: boolean;
  riskReward: number;
  minRiskReward: number;
  entryValid: boolean;
  extremeFomo: boolean;
  highRiskPump: boolean;
  fomoNotes: string[];
  independent: IndependentSignal[];
  independentRequired: number;
  extraFailed?: string[];
}): WhyNotBuyPanel {
  const available = params.independent.filter((s) => s.available);
  const agreeing = available.filter((s) => s.agrees).length;
  const items: WhyNotBuyItem[] = [
    item(
      'safety',
      'Safety score',
      params.safetyScore >= params.safetyMin && !params.criticalWarning,
      true,
      `${Math.round(params.safetyScore)} / ${params.safetyMin}`,
      params.criticalWarning
        ? 'Critical security warning'
        : params.safetyScore >= params.safetyMin
          ? 'Above your safety threshold'
          : `Safety ${Math.round(params.safetyScore)} is below ${params.safetyMin}`,
      'Safety is the first filter. A low score or critical warning means the token can still look “hot” and be untradable.',
    ),
    item(
      'signal',
      'Buy / signal score',
      params.buyScore >= params.signalMin,
      true,
      `${Math.round(params.buyScore)} / ${params.signalMin}`,
      params.buyScore >= params.signalMin
        ? 'Weighted score of independent signals is strong enough'
        : `Buy score ${Math.round(params.buyScore)} is below ${params.signalMin}`,
      'The buy score blends safety, TA, momentum, candles, smart money, sentiment, and FOMO quality. One hot metric is not enough.',
    ),
    item(
      'independent',
      'Independent signals agree',
      agreeing >= params.independentRequired,
      true,
      `${agreeing} / ${params.independentRequired} of ${available.length}`,
      agreeing >= params.independentRequired
        ? 'Enough separate confirmations lined up'
        : `Only ${agreeing} independent signal(s) agree; need ${params.independentRequired}`,
      'Do not buy every coin. Buy only when several unrelated signals say the same thing.',
    ),
    item(
      'liquidity',
      'Liquidity sufficient',
      (params.liquidityUsd ?? 0) >= params.minLiquidityUsd,
      true,
      params.liquidityUsd != null
        ? `$${Math.round(params.liquidityUsd).toLocaleString()}`
        : 'n/a',
      (params.liquidityUsd ?? 0) >= params.minLiquidityUsd
        ? 'Pool is large enough for your configured minimum'
        : `Liquidity ${params.liquidityUsd ?? 'n/a'} < ${params.minLiquidityUsd}`,
      'Thin pools make entries and exits slip, and can be easier to manipulate.',
    ),
    item(
      'rr',
      'Risk / reward',
      params.riskReward >= params.minRiskReward,
      true,
      `${params.riskReward.toFixed(2)} : 1 (min ${params.minRiskReward})`,
      params.riskReward >= params.minRiskReward
        ? 'Reward to first target is at least 2× the stop distance (default)'
        : `R:R ${params.riskReward.toFixed(2)} is below ${params.minRiskReward}`,
      'If the stop is wide and the target is close, the trade is not worth taking even if the chart looks good.',
    ),
    item(
      'security',
      'No critical security warning',
      !params.criticalWarning,
      true,
      params.criticalWarning ? 'WARNING' : 'Clear',
      params.criticalWarning
        ? 'A critical security flag blocks every buy'
        : 'No mint/freeze/rug critical flags',
      'Security failures override every bullish signal. This is not a score you can “average away”.',
    ),
    item(
      'fomo',
      'No extreme FOMO / high-risk pump',
      !params.extremeFomo && !params.highRiskPump,
      true,
      params.extremeFomo ? 'EXTREME FOMO' : params.highRiskPump ? 'PUMP RISK' : 'Calm enough',
      params.fomoNotes[0] ??
        (params.extremeFomo || params.highRiskPump
          ? 'Chase / pump conditions detected'
          : 'No extreme FOMO or pump flags'),
      'Buying after a vertical candle is how late entries get trapped. FOMO is treated as a hard no.',
    ),
    item(
      'entry',
      'Entry still valid',
      params.entryValid,
      true,
      params.entryValid ? 'VALID' : 'INVALIDATED',
      params.entryValid
        ? 'Live price is still inside the acceptable entry band'
        : 'Price already ran through the max acceptable entry — do not chase',
      'A valid setup can expire. If price has already ripped, the original entry is gone.',
    ),
  ];

  for (const sig of params.independent) {
    items.push(
      item(
        `sig_${sig.key}`,
        sig.label,
        sig.agrees,
        false,
        sig.available ? `${Math.round(sig.score ?? 0)}/100` : 'No data yet',
        sig.detail,
        'This is one independent input. It can support a buy but cannot override a failed hard gate.',
        !sig.available,
      ),
    );
  }

  for (const extra of params.extraFailed ?? []) {
    items.push(
      item(
        `extra_${extra}`,
        extra,
        false,
        true,
        'FAIL',
        extra,
        'This extra fail-safe blocked the trade.',
      ),
    );
  }

  const failed = items.filter((i) => i.blocking && !i.passed);
  const summary = params.canBuy
    ? 'Hard gates passed and enough independent signals agreed. Still a potential setup only — never guaranteed.'
    : failed.length
      ? `Rejected because: ${failed.map((f) => f.label).join('; ')}.`
      : 'Rejected — filters not met.';

  return {
    title: params.canBuy ? 'Why This Passed' : 'Why Not Buy',
    decision: params.signalType,
    buyScore: params.buyScore,
    safetyScore: params.safetyScore,
    agreeing,
    required: params.independentRequired,
    available: available.length,
    summary,
    items,
  };
}

export type MasterStrategyInput = {
  safetyScore: number;
  technicalScore: number;
  momentumScore: number;
  candlestick: CandlestickStructure;
  smartMoney: SmartMoneyScoreInput;
  social: SocialSentimentResult;
  fomo: FomoPumpResult;
  levels: TradeLevels;
  liquidityUsd: number | null;
  safetyMin?: number;
  signalMin?: number;
  minLiquidityUsd?: number;
  minRiskReward?: number;
  criticalWarning: boolean;
  dataConflict?: boolean;
  marketDataCurrent?: boolean;
  extraFailed?: string[];
  weights?: Partial<BuyScoreWeights>;
  strategiesTriggered?: number;
  exhaustion?: boolean;
};

export type MasterStrategyResult = {
  buyScore: number;
  signalScore: number;
  components: BuyScoreComponents;
  independent: IndependentSignal[];
  agreeing: number;
  required: number;
  canBuy: boolean;
  signalType: SignalType;
  failedChecks: string[];
  whyNotBuy: WhyNotBuyPanel;
};

export function evaluateMasterStrategy(
  input: MasterStrategyInput,
): MasterStrategyResult {
  const safetyMin = input.safetyMin ?? DEFAULT_RISK.safetyMin;
  const signalMin = input.signalMin ?? DEFAULT_RISK.signalMin;
  const minLiq = input.minLiquidityUsd ?? 25_000;
  const minRr = input.minRiskReward ?? DEFAULT_RISK.minRiskReward;

  const components: BuyScoreComponents = {
    safety: input.safetyScore,
    technical: input.technicalScore,
    momentum: input.momentumScore,
    candlestick: input.candlestick.score,
    smartMoney: input.smartMoney.score,
    social: input.social.score,
    fomoQuality: clamp(100 - Math.max(input.fomo.fomoScore, input.fomo.pumpScore)),
  };

  const { buyScore } = computeBuyScore({
    components,
    weights: input.weights,
  });

  const independent = collectIndependentSignals({
    technical: components.technical,
    momentum: components.momentum,
    candlestick: components.candlestick,
    smartMoney: components.smartMoney,
    social: components.social,
    smartMoneyDetail: input.smartMoney.notes[0],
  });
  const available = independent.filter((s) => s.available);
  const agreeing = available.filter((s) => s.agrees).length;
  const required = MASTER_STRATEGY.independentMin;

  const extraFailed = [...(input.extraFailed ?? [])];
  if (input.dataConflict) extraFailed.push('DATA CONFLICT between sources');
  if (input.marketDataCurrent === false) extraFailed.push('Market data stale/unavailable');

  const gates = evaluateBuyGates({
    safetyScore: input.safetyScore,
    signalScore: buyScore,
    safetyMin,
    signalMin,
    liquidityUsd: input.liquidityUsd,
    minLiquidityUsd: minLiq,
    criticalWarning: input.criticalWarning,
    dataConflict: Boolean(input.dataConflict),
    riskReward: input.levels.riskReward,
    minRiskReward: minRr,
    entryValid: input.levels.entryValid,
    marketDataCurrent: input.marketDataCurrent ?? true,
    extremeFomo: input.fomo.extremeFomo,
    highRiskPump: input.fomo.highRiskPump,
    independentAgreeing: agreeing,
    independentRequired: required,
  });

  let signalType = gates.signalType;
  if (input.criticalWarning) {
    signalType = SignalType.NO_TRADE;
  } else if (!gates.canBuy) {
    signalType = pickSignalType({
      canBuy: false,
      signalScore: buyScore,
      strategiesTriggered: input.strategiesTriggered ?? 0,
      exhaustion: input.exhaustion ?? false,
    });
  }

  const failedChecks = [
    ...gates.failedChecks,
    ...extraFailed.filter((e) => !gates.failedChecks.includes(e)),
  ];

  const whyNotBuy = buildWhyNotBuyPanel({
    canBuy: gates.canBuy,
    signalType,
    safetyScore: input.safetyScore,
    buyScore,
    safetyMin,
    signalMin,
    liquidityUsd: input.liquidityUsd,
    minLiquidityUsd: minLiq,
    criticalWarning: input.criticalWarning,
    riskReward: input.levels.riskReward,
    minRiskReward: minRr,
    entryValid: input.levels.entryValid,
    extremeFomo: input.fomo.extremeFomo,
    highRiskPump: input.fomo.highRiskPump,
    fomoNotes: input.fomo.notes,
    independent,
    independentRequired: required,
    extraFailed,
  });

  return {
    buyScore,
    signalScore: buyScore,
    components,
    independent,
    agreeing,
    required,
    canBuy: gates.canBuy,
    signalType,
    failedChecks,
    whyNotBuy,
  };
}

export function unavailableMasterResult(params: {
  safetyScore: number;
  levels: TradeLevels;
  reason: string;
  criticalWarning?: boolean;
}): MasterStrategyResult {
  const whyNotBuy = buildWhyNotBuyPanel({
    canBuy: false,
    signalType: SignalType.NO_TRADE,
    safetyScore: params.safetyScore,
    buyScore: 0,
    safetyMin: DEFAULT_RISK.safetyMin,
    signalMin: DEFAULT_RISK.signalMin,
    liquidityUsd: null,
    minLiquidityUsd: 25_000,
    criticalWarning: Boolean(params.criticalWarning),
    riskReward: params.levels.riskReward,
    minRiskReward: DEFAULT_RISK.minRiskReward,
    entryValid: false,
    extremeFomo: false,
    highRiskPump: false,
    fomoNotes: [],
    independent: collectIndependentSignals({
      technical: 0,
      momentum: 0,
      candlestick: 0,
      smartMoney: null,
      social: 0,
    }),
    independentRequired: MASTER_STRATEGY.independentMin,
    extraFailed: [params.reason],
  });
  return {
    buyScore: 0,
    signalScore: 0,
    components: {
      safety: params.safetyScore,
      technical: 0,
      momentum: 0,
      candlestick: 0,
      smartMoney: null,
      social: 0,
      fomoQuality: 50,
    },
    independent: whyNotBuy.items
      .filter((i) => i.key.startsWith('sig_'))
      .map((i) => ({
        key: i.key.replace('sig_', '') as IndependentSignal['key'],
        label: i.label,
        score: 0,
        agrees: false,
        available: i.status !== 'NEUTRAL',
        detail: i.detail,
      })),
    agreeing: 0,
    required: MASTER_STRATEGY.independentMin,
    canBuy: false,
    signalType: SignalType.NO_TRADE,
    failedChecks: [params.reason],
    whyNotBuy,
  };
}
