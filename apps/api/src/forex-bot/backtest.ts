export type WalkForwardSplit = {
  inSample: number;
  outOfSample: number;
};

export type StrategyStats = {
  trades: number;
  winRatePct: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
};

export type AntiOverfitReport = {
  passed: boolean;
  reasons: string[];
  inSample: StrategyStats;
  outOfSample: StrategyStats;
  note: string;
};

export function splitWalkForward(n: number, isRatio = 0.7): WalkForwardSplit {
  const inSample = Math.floor(n * isRatio);
  return { inSample, outOfSample: n - inSample };
}

export function statsFromR(rs: number[]): StrategyStats {
  const trades = rs.length;
  if (!trades) {
    return { trades: 0, winRatePct: 0, expectancyR: 0, profitFactor: 0, maxDrawdownR: 0 };
  }
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const grossWin = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const r of rs) {
    eq += r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return {
    trades,
    winRatePct: Number(((wins.length / trades) * 100).toFixed(1)),
    expectancyR: Number((rs.reduce((s, r) => s + r, 0) / trades).toFixed(3)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : 0,
    maxDrawdownR: Number(dd.toFixed(2)),
  };
}

export function antiOverfit(is: number[], oos: number[]): AntiOverfitReport {
  const inSample = statsFromR(is);
  const outOfSample = statsFromR(oos);
  const reasons: string[] = [];
  if (inSample.trades < 80) reasons.push(`In-sample trades ${inSample.trades} < 80`);
  if (outOfSample.trades < 40) reasons.push(`Out-of-sample trades ${outOfSample.trades} < 40`);
  if (outOfSample.expectancyR <= 0) reasons.push('Out-of-sample expectancy is not positive');
  if (outOfSample.profitFactor < 1.05) reasons.push('Out-of-sample profit factor < 1.05');
  if (inSample.expectancyR > 0 && outOfSample.expectancyR > 0 && inSample.expectancyR / outOfSample.expectancyR > 2) {
    reasons.push('In-sample expectancy more than 2× out-of-sample — likely overfit');
  }
  if (inSample.winRatePct - outOfSample.winRatePct > 15) {
    reasons.push('Win rate dropped more than 15pp out of sample');
  }
  return {
    passed: reasons.length === 0,
    reasons,
    inSample,
    outOfSample,
    note: 'Forward-test on unseen data is required before live size. Passing this check is not a guarantee.',
  };
}

/** Deterministic demo path for the UI when no broker history exists. */
export function demoWalkForward(): { report: AntiOverfitReport; requirement: string } {
  const is: number[] = [];
  const oos: number[] = [];
  for (let i = 0; i < 100; i++) is.push(i % 5 === 0 ? -1 : 0.55);
  for (let i = 0; i < 50; i++) oos.push(i % 6 === 0 ? -1 : 0.4);
  return {
    report: antiOverfit(is, oos),
    requirement:
      'Backtest must use walk-forward (IS then OOS). Do not tune parameters on the OOS window. Paper-trade the frozen rules before live.',
  };
}
