import { evaluateRiskLimits, type RiskLimitInput } from '@memecoinbot/risk';

export type PreTradeMode = 'MANUAL' | 'AUTO';

export type PreTradeCheckInput = {
  mode: PreTradeMode;
  killSwitch: boolean;
  emergencyStop: boolean;
  autoTradingEnabled: boolean;
  walletAuthorized: boolean;
  safetyScore: number;
  signalScore: number;
  safetyMin: number;
  signalMin: number;
  criticalWarning: boolean;
  liquidityUsd: number | null;
  minLiquidityUsd: number;
  axiomUnavailable: boolean;
  axiomRequiredForAutoTrading: boolean;
  dexDataAgeSec: number | null;
  jupiterQuoteOk: boolean;
  maxDataAgeSec?: number;
  slippageBps: number;
  maxSlippageBps: number;
  riskReward: number;
  minRiskReward: number;
  positionSizeUsd: number;
  entryValid: boolean;
  dataConflict: boolean;
  riskLimits: RiskLimitInput;
};

export type PreTradeCheckItem = {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
};

export type PreTradeCheckResult = {
  allowed: boolean;
  checks: PreTradeCheckItem[];
  failed: string[];
};

function add(
  checks: PreTradeCheckItem[],
  key: string,
  label: string,
  passed: boolean,
  detail?: string,
) {
  checks.push({ key, label, passed, detail });
}

/**
 * Shared pre-trade gate for manual real and (future) auto trading.
 * Any failed check → DO NOT EXECUTE.
 */
export function runPreTradeChecks(input: PreTradeCheckInput): PreTradeCheckResult {
  const checks: PreTradeCheckItem[] = [];
  const maxAge = input.maxDataAgeSec ?? 120;

  if (input.mode === 'AUTO') {
    add(
      checks,
      'auto_enabled',
      'Auto trading enabled',
      input.autoTradingEnabled,
      input.autoTradingEnabled ? undefined : 'AUTO TRADING OFF',
    );
  }

  add(
    checks,
    'kill_switch',
    'Kill switch inactive',
    !input.killSwitch,
    input.killSwitch ? 'KILL SWITCH ON — NO REAL TRADES' : undefined,
  );

  add(
    checks,
    'emergency_stop',
    'Emergency stop inactive',
    !input.emergencyStop,
    input.emergencyStop ? 'EMERGENCY STOP active — new trades blocked' : undefined,
  );

  add(
    checks,
    'wallet',
    'Wallet authorized',
    input.walletAuthorized,
    input.walletAuthorized ? undefined : 'No wallet public key set',
  );

  add(
    checks,
    'safety',
    'Safety score passed',
    input.safetyScore >= input.safetyMin && !input.criticalWarning,
    input.criticalWarning
      ? 'Critical security warning — NO TRADE'
      : `${Math.round(input.safetyScore)} < ${input.safetyMin}`,
  );

  add(
    checks,
    'signal',
    'Signal score passed',
    input.signalScore >= input.signalMin,
    `${Math.round(input.signalScore)} < ${input.signalMin}`,
  );

  const liqOk =
    input.liquidityUsd != null && input.liquidityUsd >= input.minLiquidityUsd;
  add(
    checks,
    'liquidity',
    'Liquidity sufficient',
    liqOk,
    liqOk
      ? undefined
      : `Liquidity ${input.liquidityUsd ?? 'n/a'} < ${input.minLiquidityUsd}`,
  );

  add(
    checks,
    'security',
    'Security passed',
    !input.criticalWarning,
    input.criticalWarning ? 'Critical security warning' : undefined,
  );

  if (input.mode === 'AUTO' && input.axiomRequiredForAutoTrading) {
    add(
      checks,
      'axiom',
      'Axiom requirement satisfied',
      !input.axiomUnavailable,
      input.axiomUnavailable ? 'AXIOM DATA UNAVAILABLE — auto blocked' : undefined,
    );
  }

  const dexFresh =
    input.dexDataAgeSec != null && input.dexDataAgeSec <= maxAge;
  add(
    checks,
    'dex_fresh',
    'DEX data current',
    dexFresh,
    dexFresh
      ? undefined
      : `DEX data age ${input.dexDataAgeSec ?? 'unknown'}s (max ${maxAge}s)`,
  );

  add(
    checks,
    'jupiter',
    'Jupiter quote current',
    input.jupiterQuoteOk,
    input.jupiterQuoteOk ? undefined : 'Jupiter route/quote unavailable',
  );

  add(
    checks,
    'slippage',
    'Slippage acceptable',
    input.slippageBps <= input.maxSlippageBps,
    `${input.slippageBps} bps > max ${input.maxSlippageBps} bps`,
  );

  add(
    checks,
    'risk_reward',
    'Risk/reward acceptable',
    input.riskReward >= input.minRiskReward,
    `R:R ${input.riskReward.toFixed(2)} < ${input.minRiskReward}`,
  );

  add(
    checks,
    'position_size',
    'Position size valid',
    input.positionSizeUsd > 0,
    input.positionSizeUsd > 0 ? undefined : 'Invalid position size',
  );

  const limits = evaluateRiskLimits({
    ...input.riskLimits,
    proposedSizeUsd: input.positionSizeUsd,
  });
  add(
    checks,
    'risk_limits',
    'Risk limits OK',
    limits.allowed,
    limits.allowed ? undefined : limits.reasons.join('; '),
  );

  add(
    checks,
    'entry',
    'Entry still valid',
    input.entryValid,
    input.entryValid ? undefined : 'ENTRY INVALIDATED',
  );

  add(
    checks,
    'consensus',
    'No major data conflict',
    !input.dataConflict,
    input.dataConflict ? 'DATA CONFLICT between sources' : undefined,
  );

  // Fix detail strings for passed checks that incorrectly show failure text
  for (const c of checks) {
    if (c.passed) {
      c.detail = undefined;
    }
  }

  const failed = checks.filter((c) => !c.passed).map((c) => c.label);
  return { allowed: failed.length === 0, checks, failed };
}
