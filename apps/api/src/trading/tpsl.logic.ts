export function takeProfitPrice(entry: number, pct: number): number {
  return entry * (1 + pct / 100);
}

export function stopLossPrice(entry: number, pct: number): number {
  return entry * (1 - Math.abs(pct) / 100);
}

export function shouldTriggerTakeProfit(
  entry: number,
  current: number,
  tpPct: number,
): boolean {
  if (!(entry > 0) || !(current > 0) || !(tpPct > 0)) return false;
  return current >= takeProfitPrice(entry, tpPct);
}

export function shouldTriggerStopLoss(
  entry: number,
  current: number,
  slPct: number,
): boolean {
  if (!(entry > 0) || !(current > 0) || !(Math.abs(slPct) > 0)) return false;
  return current <= stopLossPrice(entry, slPct);
}

export function roiPct(entry: number, current: number): number {
  if (!(entry > 0) || !Number.isFinite(current)) return 0;
  return ((current - entry) / entry) * 100;
}

/** Auto-execution is not available without a custodial/server signer. */
export const TPSL_EXECUTION_MODE = 'ALERT' as const;

export function tpslExecutionClaim(mode: 'ALERT' | 'AUTO_EXECUTE'): {
  canAutoExecute: boolean;
  label: string;
} {
  if (mode === 'AUTO_EXECUTE') {
    return {
      canAutoExecute: false,
      label: 'Automatic execution is not enabled. This is an alert only.',
    };
  }
  return { canAutoExecute: false, label: 'Alert only — sell is not submitted until you confirm.' };
}
