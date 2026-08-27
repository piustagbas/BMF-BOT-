import type { ProviderResult } from './types';
import { getTokenAccountsByOwner } from './solana-rpc';
import type { SmartWallet } from '@memecoinbot/shared';

export type SmartMoneyHolding = {
  wallet: SmartWallet;
  holds: boolean;
  amount: number;
};

export type SmartMoneyInspection = {
  mint: string;
  walletsChecked: number;
  holders: number;
  unavailable: boolean;
  holdings: SmartMoneyHolding[];
  error?: string;
};

export function parseSplTokenAmount(result: unknown): number {
  const value = (result as { value?: unknown[] } | null)?.value;
  if (!Array.isArray(value) || value.length === 0) return 0;
  let total = 0;
  for (const item of value) {
    const info = (item as { account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } } } })
      ?.account?.data?.parsed?.info?.tokenAmount;
    const amt = info?.uiAmount;
    if (typeof amt === 'number' && Number.isFinite(amt)) total += amt;
  }
  return total;
}

const cache = new Map<string, { at: number; data: SmartMoneyInspection }>();
const CACHE_MS = 90_000;

export async function inspectSmartMoneyWallets(
  mint: string,
  wallets: SmartWallet[],
): Promise<ProviderResult<SmartMoneyInspection>> {
  const unique = wallets.filter((w) => w.address).slice(0, 20);
  const cacheKey = `${mint}:${unique.map((w) => w.address).join(',')}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return { ok: true, data: hit.data };
  }

  if (unique.length === 0) {
    const empty: SmartMoneyInspection = {
      mint,
      walletsChecked: 0,
      holders: 0,
      unavailable: true,
      holdings: [],
    };
    return { ok: true, data: empty };
  }

  try {
    const holdings: SmartMoneyHolding[] = [];
    let rpcFails = 0;
    const results = await Promise.all(
      unique.map(async (wallet) => {
        const res = await getTokenAccountsByOwner(wallet.address, mint);
        return { wallet, res };
      }),
    );

    for (const { wallet, res } of results) {
      if (!res.ok) {
        rpcFails += 1;
        continue;
      }
      const amount = parseSplTokenAmount(res.data);
      holdings.push({
        wallet,
        holds: amount > 0,
        amount,
      });
    }

    const unavailable = holdings.length === 0 && rpcFails === unique.length;
    const data: SmartMoneyInspection = {
      mint,
      walletsChecked: holdings.length,
      holders: holdings.filter((h) => h.holds).length,
      unavailable,
      holdings,
      error: unavailable ? 'Solana RPC could not check tracked wallets' : undefined,
    };
    cache.set(cacheKey, { at: Date.now(), data });
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Smart money inspect failed',
    };
  }
}
