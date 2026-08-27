import { describe, expect, it } from 'vitest';
import { runPreTradeChecks, type PreTradeCheckInput } from './index';

function base(overrides: Partial<PreTradeCheckInput> = {}): PreTradeCheckInput {
  return {
    mode: 'MANUAL',
    killSwitch: false,
    emergencyStop: false,
    autoTradingEnabled: false,
    walletAuthorized: true,
    safetyScore: 85,
    signalScore: 82,
    safetyMin: 80,
    signalMin: 80,
    criticalWarning: false,
    liquidityUsd: 50_000,
    minLiquidityUsd: 25_000,
    axiomUnavailable: true,
    axiomRequiredForAutoTrading: true,
    dexDataAgeSec: 10,
    jupiterQuoteOk: true,
    slippageBps: 100,
    maxSlippageBps: 300,
    riskReward: 2,
    minRiskReward: 1.5,
    positionSizeUsd: 50,
    entryValid: true,
    dataConflict: false,
    riskLimits: {
      accountBalance: 1000,
      startingBalance: 1000,
      openPositions: 0,
      dailyTrades: 0,
      dailyRealizedPnl: 0,
      consecutiveLosses: 0,
      currentExposureUsd: 0,
      proposedSizeUsd: 50,
    },
    ...overrides,
  };
}

describe('runPreTradeChecks', () => {
  it('allows a clean manual proposal', () => {
    const r = runPreTradeChecks(base());
    expect(r.allowed).toBe(true);
    expect(r.failed).toEqual([]);
  });

  it('blocks when kill switch is on', () => {
    const r = runPreTradeChecks(base({ killSwitch: true }));
    expect(r.allowed).toBe(false);
    expect(r.failed).toContain('Kill switch inactive');
  });

  it('blocks AUTO when axiom required and unavailable', () => {
    const r = runPreTradeChecks(
      base({ mode: 'AUTO', autoTradingEnabled: true, axiomUnavailable: true }),
    );
    expect(r.allowed).toBe(false);
    expect(r.failed).toContain('Axiom requirement satisfied');
  });

  it('does not require axiom for MANUAL even when unavailable', () => {
    const r = runPreTradeChecks(base({ axiomUnavailable: true }));
    expect(r.checks.find((c) => c.key === 'axiom')).toBeUndefined();
    expect(r.allowed).toBe(true);
  });

  it('blocks on entry invalidated or data conflict', () => {
    expect(runPreTradeChecks(base({ entryValid: false })).allowed).toBe(false);
    expect(runPreTradeChecks(base({ dataConflict: true })).allowed).toBe(false);
  });
});
