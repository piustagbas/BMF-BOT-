export type PlatformFeeConfig = {
  bps: number;
  wallet: string | null;
  account: string | null;
  network: string;
  router: string;
};

const MAX_FEE_BPS = 500; // 5%

export function readPlatformFeeConfig(env: NodeJS.ProcessEnv = process.env): PlatformFeeConfig {
  const raw = Number(env.PLATFORM_FEE_BPS ?? 50);
  const bps = Number.isFinite(raw) ? Math.max(0, Math.min(MAX_FEE_BPS, Math.round(raw))) : 50;
  const wallet = env.PLATFORM_FEE_WALLET?.trim() || null;
  const account = env.PLATFORM_FEE_ACCOUNT?.trim() || null;
  return {
    bps,
    wallet,
    account,
    network: 'solana',
    router: 'jupiter',
  };
}

export function platformFeeUsd(amountUsd: number, bps: number): number {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || bps <= 0) return 0;
  return (amountUsd * bps) / 10_000;
}

export function amountAfterPlatformFeeUsd(amountUsd: number, bps: number): number {
  const fee = platformFeeUsd(amountUsd, bps);
  return Math.max(0, amountUsd - fee);
}

export function canCollectOnChain(config: PlatformFeeConfig): boolean {
  return config.bps > 0 && Boolean(config.account || config.wallet);
}

/** Jupiter feeAccount — referral token account, or owner wallet if that is what you set. */
export function feeAccountForSwap(config: PlatformFeeConfig): string | null {
  return config.account || config.wallet;
}
