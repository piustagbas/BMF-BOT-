import { looksLikeSolanaAddress } from '@memecoinbot/shared';
import { platformFeeUsd } from './platform-fee';
import { type SwapErrorCode, safeSwapMessage } from './swap.errors';

export type TradeStatus =
  | 'PREPARING'
  | 'AWAITING_WALLET'
  | 'SUBMITTED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'REJECTED';

export const TRADE_FLOW: TradeStatus[] = [
  'PREPARING',
  'AWAITING_WALLET',
  'SUBMITTED',
  'PENDING',
  'CONFIRMED',
];

export const TERMINAL_STATUSES: TradeStatus[] = ['CONFIRMED', 'FAILED', 'REJECTED'];

export function isTerminalStatus(status: TradeStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canSubmitStatus(status: TradeStatus): boolean {
  return status === 'AWAITING_WALLET' || status === 'PREPARING';
}

export function validateMint(address: string): SwapErrorCode | null {
  if (!looksLikeSolanaAddress(address)) return 'INVALID_ADDRESS';
  return null;
}

export function validateWallet(address: string | null | undefined): SwapErrorCode | null {
  if (!address) return 'WALLET_DISCONNECTED';
  if (!looksLikeSolanaAddress(address)) return 'INVALID_WALLET';
  return null;
}

export function validateAmountUsd(amountUsd: number): SwapErrorCode | null {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 'INVALID_AMOUNT';
  if (amountUsd < 0.5) return 'INVALID_AMOUNT';
  if (amountUsd > 100_000) return 'INVALID_AMOUNT';
  return null;
}

export function usdToSolLamports(amountUsd: number, solPriceUsd: number): bigint {
  if (!(solPriceUsd > 0) || !(amountUsd > 0)) return 0n;
  const sol = amountUsd / solPriceUsd;
  return BigInt(Math.floor(sol * 1e9));
}

export function lamportsToUsd(lamports: number | bigint, solPriceUsd: number): number {
  const n = typeof lamports === 'bigint' ? Number(lamports) : lamports;
  if (!Number.isFinite(n) || !(solPriceUsd > 0)) return 0;
  return (n / 1e9) * solPriceUsd;
}

export function atomicToUi(amountAtomic: string, decimals: number): number {
  try {
    const raw = BigInt(amountAtomic);
    const div = 10n ** BigInt(Math.min(Math.max(decimals, 0), 18));
    return Number(raw) / Number(div);
  } catch {
    return 0;
  }
}

export function uiToAtomic(amount: number, decimals: number): string {
  if (!(amount > 0)) return '0';
  const scale = 10 ** Math.min(Math.max(decimals, 0), 12);
  return BigInt(Math.floor(amount * scale)).toString();
}

export function applyPercent(balance: number, pct: number): number {
  const p = Math.max(0, Math.min(100, pct));
  return balance * (p / 100);
}

export type QuoteBreakdown = {
  amountUsd: number;
  platformFeeUsd: number;
  platformFeeBps: number;
  networkFeeUsd: number;
  totalUsd: number;
  estimatedReceived: number;
  minimumReceived: number;
  priceImpactPct: number | null;
  currentPrice: number | null;
};

export function buildQuoteBreakdown(opts: {
  amountUsd: number;
  platformFeeBps: number;
  networkFeeUsd: number;
  estimatedReceived: number;
  minimumReceived: number;
  priceImpactPct: number | null;
  currentPrice: number | null;
}): QuoteBreakdown {
  const fee = platformFeeUsd(opts.amountUsd, opts.platformFeeBps);
  return {
    amountUsd: opts.amountUsd,
    platformFeeUsd: fee,
    platformFeeBps: opts.platformFeeBps,
    networkFeeUsd: Math.max(0, opts.networkFeeUsd),
    totalUsd: opts.amountUsd + Math.max(0, opts.networkFeeUsd),
    estimatedReceived: opts.estimatedReceived,
    minimumReceived: opts.minimumReceived,
    priceImpactPct: opts.priceImpactPct,
    currentPrice: opts.currentPrice,
  };
}

export function computeAvgEntry(
  prevQty: number,
  prevAvg: number,
  addQty: number,
  addPrice: number,
): { qty: number; avgEntry: number } {
  const nextQty = Math.max(0, prevQty + addQty);
  if (nextQty <= 0) return { qty: 0, avgEntry: 0 };
  if (prevQty <= 0) return { qty: addQty, avgEntry: addPrice };
  const avgEntry = (prevQty * prevAvg + addQty * addPrice) / nextQty;
  return { qty: nextQty, avgEntry };
}

export function reducePosition(
  prevQty: number,
  prevAvg: number,
  sellQty: number,
  exitPrice: number,
): { qty: number; avgEntry: number; realizedPnlUsd: number } {
  const qtySold = Math.min(prevQty, Math.max(0, sellQty));
  const realizedPnlUsd = qtySold * (exitPrice - prevAvg);
  const qty = Math.max(0, prevQty - qtySold);
  return { qty, avgEntry: qty > 0 ? prevAvg : 0, realizedPnlUsd };
}

export function unrealizedPnl(qty: number, avgEntry: number, currentPrice: number): {
  valueUsd: number;
  pnlUsd: number;
  roiPct: number;
} {
  const valueUsd = qty * currentPrice;
  const cost = qty * avgEntry;
  const pnlUsd = valueUsd - cost;
  const roiPct = cost > 0 ? (pnlUsd / cost) * 100 : 0;
  return { valueUsd, pnlUsd, roiPct };
}

export function assertNotDuplicate(existingSignature: string | null, incoming: string): void {
  if (existingSignature && existingSignature === incoming) {
    const err = new Error(safeSwapMessage('DUPLICATE'));
    (err as Error & { code: SwapErrorCode }).code = 'DUPLICATE';
    throw err;
  }
}

export function estimateNetworkFeeUsd(solPriceUsd: number, lamports = 15_000): number {
  return lamportsToUsd(lamports, solPriceUsd);
}
