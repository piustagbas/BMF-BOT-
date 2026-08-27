import type { ClosedRoundTrip, DexTrade, OpenLot } from './types';

function clamp(n: number, lo = 0, hi = 1): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function pairRoundTrips(
  trades: DexTrade[],
  markPriceByToken: Record<string, number> = {},
): { closed: ClosedRoundTrip[]; open: OpenLot[] } {
  const byKey = new Map<string, DexTrade[]>();
  for (const t of trades) {
    if (!t.wallet || !t.token || !Number.isFinite(t.timestamp)) continue;
    const key = `${t.wallet}:${t.token}`;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }

  const closed: ClosedRoundTrip[] = [];
  const open: OpenLot[] = [];

  for (const [, list] of byKey) {
    const ordered = [...list].sort((a, b) => a.timestamp - b.timestamp || a.txHash.localeCompare(b.txHash));
    const lots: OpenLot[] = [];
    for (const t of ordered) {
      if (t.type === 'buy' && t.amount > 0 && t.usdValue >= 0) {
        lots.push({
          wallet: t.wallet,
          token: t.token,
          entryTime: t.timestamp,
          entryPrice: t.price > 0 ? t.price : t.usdValue / Math.max(t.amount, 1e-12),
          remainingAmount: t.amount,
          usdIn: t.usdValue,
          entryMarketCap: t.marketCap,
          buyTx: t.txHash,
        });
        continue;
      }
      if (t.type !== 'sell' || t.amount <= 0) continue;
      let remaining = t.amount;
      const sellPrice = t.price > 0 ? t.price : t.usdValue / Math.max(t.amount, 1e-12);
      while (remaining > 1e-12 && lots.length) {
        const lot = lots[0]!;
        const take = Math.min(lot.remainingAmount, remaining);
        const frac = take / Math.max(lot.remainingAmount, 1e-12);
        const usdIn = lot.usdIn * frac;
        const usdOut = sellPrice * take;
        closed.push({
          wallet: t.wallet,
          token: t.token,
          entryTime: lot.entryTime,
          exitTime: t.timestamp,
          entryPrice: lot.entryPrice,
          exitPrice: sellPrice,
          entryMarketCap: lot.entryMarketCap,
          usdIn,
          usdOut,
          pnl: usdOut - usdIn,
          roi: usdIn > 0 ? (usdOut - usdIn) / usdIn : 0,
          holdMs: Math.max(0, t.timestamp - lot.entryTime),
          buyTx: lot.buyTx,
          sellTx: t.txHash,
        });
        lot.remainingAmount -= take;
        lot.usdIn -= usdIn;
        remaining -= take;
        if (lot.remainingAmount <= 1e-12) lots.shift();
      }
    }
    for (const lot of lots) {
      if (lot.remainingAmount <= 1e-12) continue;
      open.push(lot);
    }
  }

  void markPriceByToken;
  return { closed, open };
}

export function unrealizedPnl(
  open: OpenLot[],
  markPriceByToken: Record<string, number>,
): number {
  let pnl = 0;
  for (const lot of open) {
    const mark = markPriceByToken[lot.token];
    if (mark == null || !Number.isFinite(mark)) continue;
    pnl += mark * lot.remainingAmount - lot.usdIn;
  }
  return pnl;
}

export function maxDrawdownFromPnls(pnls: number[]): number {
  if (!pnls.length) return 0;
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const p of pnls) {
    equity += p;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return maxDd;
}

export function herfindahl(weights: number[]): number {
  const pos = weights.filter((w) => w > 0);
  const sum = pos.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 1;
  return pos.reduce((acc, w) => acc + (w / sum) ** 2, 0);
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}
