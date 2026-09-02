import { describe, expect, it } from 'vitest';
import {
  amountAfterPlatformFeeUsd,
  canCollectOnChain,
  feeAccountForSwap,
  platformFeeUsd,
  readPlatformFeeConfig,
} from './platform-fee';

describe('platform fee', () => {
  it('charges 0.5% of $100 as $0.50 and does not call it gas', () => {
    expect(platformFeeUsd(100, 50)).toBe(0.5);
    expect(amountAfterPlatformFeeUsd(100, 50)).toBe(99.5);
  });

  it('reads bps from env without frontend hardcoding', () => {
    const cfg = readPlatformFeeConfig({ PLATFORM_FEE_BPS: '75' } as NodeJS.ProcessEnv);
    expect(cfg.bps).toBe(75);
    expect(cfg.network).toBe('solana');
    expect(cfg.router).toBe('jupiter');
  });

  it('clamps fee bps and requires a fee account to collect on-chain', () => {
    const high = readPlatformFeeConfig({ PLATFORM_FEE_BPS: '9999' } as NodeJS.ProcessEnv);
    expect(high.bps).toBe(500);
    expect(canCollectOnChain(high)).toBe(false);
    const withWallet = readPlatformFeeConfig({
      PLATFORM_FEE_BPS: '50',
      PLATFORM_FEE_WALLET: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    } as NodeJS.ProcessEnv);
    expect(canCollectOnChain(withWallet)).toBe(true);
  });

  it('uses wallet as fee account when no separate token account is set', () => {
    const cfg = readPlatformFeeConfig({
      PLATFORM_FEE_BPS: '50',
      PLATFORM_FEE_WALLET: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    } as NodeJS.ProcessEnv);
    expect(feeAccountForSwap(cfg)).toBe('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
    expect(canCollectOnChain(cfg)).toBe(true);
  });

  it('returns 0 fee for invalid amounts', () => {
    expect(platformFeeUsd(0, 50)).toBe(0);
    expect(platformFeeUsd(-10, 50)).toBe(0);
  });
});
