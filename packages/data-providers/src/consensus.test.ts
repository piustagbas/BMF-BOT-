import { describe, expect, it } from 'vitest';
import { comparePrices } from './consensus';
import { mapPairToSnapshot, pickBestSolanaPair, resolveDexImageUrl } from './dexscreener';

describe('comparePrices', () => {
  it('flags DATA CONFLICT when deviation exceeds threshold', () => {
    const result = comparePrices(1.0, 1.3, 15);
    expect(result.conflict).toBe(true);
    expect(result.conflictReason).toContain('DATA CONFLICT');
  });

  it('does not conflict when one price is missing', () => {
    const result = comparePrices(1.0, null);
    expect(result.conflict).toBe(false);
  });

  it('accepts prices within threshold', () => {
    const result = comparePrices(1.0, 1.05, 15);
    expect(result.conflict).toBe(false);
  });
});

describe('dexscreener mappers', () => {
  it('maps pair payload fields', () => {
    const snap = mapPairToSnapshot({
      chainId: 'solana',
      dexId: 'raydium',
      pairAddress: 'Pair111',
      baseToken: { address: 'Token1111111111111111111111111111111111111', name: 'Test', symbol: 'TST' },
      quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'SOL', symbol: 'SOL' },
      priceUsd: '0.01',
      marketCap: 100000,
      fdv: 120000,
      liquidity: { usd: 50000 },
      volume: { h24: 20000 },
      priceChange: { h24: 5.5 },
      txns: { h24: { buys: 10, sells: 4 } },
      pairCreatedAt: Date.now() - 2 * 60 * 60 * 1000,
      info: { imageUrl: 'https://cdn.example.com/token.png' },
    });

    expect(snap.baseToken.symbol).toBe('TST');
    expect(snap.imageUrl).toBe('https://cdn.example.com/token.png');
    expect(snap.priceUsd).toBe(0.01);
    expect(snap.liquidityUsd).toBe(50000);
    expect(snap.buys24h).toBe(10);
    expect(snap.pairAgeHours).toBeGreaterThan(1.5);
  });

  it('resolves dex cms icon ids to full urls', () => {
    expect(resolveDexImageUrl('Im_Si_AC4e8BjDzm')).toContain('cdn.dexscreener.com');
    expect(resolveDexImageUrl('https://cdn.dexscreener.com/x.png')).toBe(
      'https://cdn.dexscreener.com/x.png',
    );
  });

  it('prefers a pair that has a logo when liquidity is close', () => {
    const best = pickBestSolanaPair([
      mapPairToSnapshot({
        chainId: 'solana',
        dexId: 'a',
        pairAddress: '1',
        baseToken: { address: 'A', name: 'A', symbol: 'A' },
        quoteToken: { address: 'S', name: 'S', symbol: 'S' },
        liquidity: { usd: 1000 },
      }),
      mapPairToSnapshot({
        chainId: 'solana',
        dexId: 'b',
        pairAddress: '2',
        baseToken: { address: 'A', name: 'A', symbol: 'A' },
        quoteToken: { address: 'S', name: 'S', symbol: 'S' },
        liquidity: { usd: 9000 },
      }),
      mapPairToSnapshot({
        chainId: 'ethereum',
        dexId: 'c',
        pairAddress: '3',
        baseToken: { address: 'A', name: 'A', symbol: 'A' },
        quoteToken: { address: 'S', name: 'S', symbol: 'S' },
        liquidity: { usd: 99999 },
      }),
    ]);

    expect(best?.pairAddress).toBe('2');
    expect(best?.liquidityUsd).toBe(9000);

    const withLogo = pickBestSolanaPair([
      mapPairToSnapshot({
        chainId: 'solana',
        dexId: 'a',
        pairAddress: 'low-logo',
        baseToken: { address: 'A', name: 'A', symbol: 'A' },
        quoteToken: { address: 'S', name: 'S', symbol: 'S' },
        liquidity: { usd: 1000 },
        info: { imageUrl: 'https://cdn.example.com/a.png' },
      }),
      mapPairToSnapshot({
        chainId: 'solana',
        dexId: 'b',
        pairAddress: 'high-nologo',
        baseToken: { address: 'A', name: 'A', symbol: 'A' },
        quoteToken: { address: 'S', name: 'S', symbol: 'S' },
        liquidity: { usd: 9000 },
      }),
    ]);
    expect(withLogo?.pairAddress).toBe('low-logo');
    expect(withLogo?.imageUrl).toContain('cdn.example.com');
  });
});
