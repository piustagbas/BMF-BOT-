import { describe, expect, it } from 'vitest';
import { DEFAULT_TRADING_FLAGS } from '@memecoinbot/shared';

describe('api safety defaults', () => {
  it('never enables auto trading by default', () => {
    expect(DEFAULT_TRADING_FLAGS.autoTradingEnabled).toBe(false);
    expect(DEFAULT_TRADING_FLAGS.killSwitch).toBe(true);
  });
});
