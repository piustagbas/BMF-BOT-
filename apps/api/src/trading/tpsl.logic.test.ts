import { describe, expect, it } from 'vitest';
import {
  shouldTriggerStopLoss,
  shouldTriggerTakeProfit,
  tpslExecutionClaim,
} from './tpsl.logic';

describe('take profit / stop loss', () => {
  it('triggers +50% TP and -15% SL from a 0.001 entry', () => {
    expect(shouldTriggerTakeProfit(0.001, 0.0015, 50)).toBe(true);
    expect(shouldTriggerTakeProfit(0.001, 0.0012, 50)).toBe(false);
    expect(shouldTriggerStopLoss(0.001, 0.00085, 15)).toBe(true);
    expect(shouldTriggerStopLoss(0.001, 0.00095, 15)).toBe(false);
  });

  it('never claims an alert was an executed order', () => {
    const claim = tpslExecutionClaim('ALERT');
    expect(claim.canAutoExecute).toBe(false);
    expect(claim.label.toLowerCase()).toMatch(/alert/);
    const auto = tpslExecutionClaim('AUTO_EXECUTE');
    expect(auto.canAutoExecute).toBe(false);
  });
});
