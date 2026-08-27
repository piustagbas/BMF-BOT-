import { describe, expect, it } from 'vitest';
import { mapGeckoTrade } from './gecko-trades';
import { mapHeliusSwap } from './helius-trades';
import { mapBirdeyeTx } from './birdeye-trades';
import { mergeTradeFeeds } from './trade-feed';

const mint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const wallet = '5tzFkiKscXHK5ZXCAmPqzGBqbwbx4t5eXvz4MFuns1hF';

describe('trade feed mappers', () => {
  it('maps GeckoTerminal pool trades', () => {
    const t = mapGeckoTrade(
      {
        attributes: {
          tx_from_address: wallet,
          tx_hash: 'sig1',
          kind: 'buy',
          block_timestamp: '2026-01-01T00:00:00Z',
          volume_in_usd: '12.5',
          to_token_amount: '1000',
          from_token_amount: '0.1',
          price_to_in_usd: '0.0125',
        },
      },
      { mint, poolAddress: 'pool', marketCap: 90_000, liquidity: 40_000 },
    );
    expect(t?.type).toBe('buy');
    expect(t?.wallet).toBe(wallet);
    expect(t?.provider).toBe('geckoterminal');
    expect(t?.usdValue).toBe(12.5);
  });

  it('maps Helius swaps for a wallet and skips wrapped SOL', () => {
    const trades = mapHeliusSwap(
      {
        signature: 'sig2',
        timestamp: 1_700_000_000,
        tokenTransfers: [
          {
            toUserAccount: wallet,
            mint,
            tokenAmount: 50,
          },
          {
            toUserAccount: wallet,
            mint: 'So11111111111111111111111111111111111111112',
            tokenAmount: 1,
          },
        ],
      },
      wallet,
    );
    expect(trades).toHaveLength(1);
    expect(trades[0]?.token).toBe(mint);
    expect(trades[0]?.type).toBe('buy');
  });

  it('maps Birdeye token txs', () => {
    const t = mapBirdeyeTx(
      {
        owner: wallet,
        txHash: 'sig3',
        side: 'sell',
        blockUnixTime: 1_700_000_000,
        volumeUSD: 20,
        tokenAmount: 10,
        priceUsd: 2,
      },
      { mint },
    );
    expect(t?.type).toBe('sell');
    expect(t?.usdValue).toBe(20);
  });

  it('dedupes merged feeds by tx/wallet/type', () => {
    const a = {
      wallet,
      token: mint,
      type: 'buy' as const,
      amount: 1,
      usdValue: 1,
      price: 1,
      marketCap: null,
      liquidity: null,
      timestamp: 1,
      txHash: 'x',
      provider: 'a',
    };
    const merged = mergeTradeFeeds([a, { ...a, provider: 'b' }]);
    expect(merged).toHaveLength(1);
  });
});
