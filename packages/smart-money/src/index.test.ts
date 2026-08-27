import { describe, expect, it } from 'vitest';
import { MemeSignalLevel, WalletTier } from '@memecoinbot/shared';
import {
  backtestWallet,
  classifyWallet,
  clusterWallets,
  computeMemeCoinScore,
  computeWalletStats,
  decayedSmartScore,
  detectConsensus,
  detectRisk,
  evaluateExclusions,
  formatSmartMoneyAlert,
  pairRoundTrips,
  scoreWallet,
  tierInfluence,
} from './index';
import type { DexTrade } from './types';
import type { ScoredWallet } from './types';

const W1 = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const W2 = 'So11111111111111111111111111111111111111113';
const W3 = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiKLnD';
const W4 = '5tzFkiKscXHK5ZXCAmPqzGBqbwbx4t5eXvz4MFuns1hG';
const COPY = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWN';

function buy(
  wallet: string,
  token: string,
  t: number,
  price: number,
  usd = 100,
  mcap = 80_000,
): DexTrade {
  return {
    wallet,
    token,
    type: 'buy',
    amount: usd / price,
    usdValue: usd,
    price,
    marketCap: mcap,
    liquidity: 40_000,
    timestamp: t,
    txHash: `b-${wallet.slice(0, 4)}-${token}-${t}`,
  };
}

function sell(
  wallet: string,
  token: string,
  t: number,
  price: number,
  usd = 140,
): DexTrade {
  return {
    wallet,
    token,
    type: 'sell',
    amount: usd / price,
    usdValue: usd,
    price,
    marketCap: 120_000,
    liquidity: 50_000,
    timestamp: t,
    txHash: `s-${wallet.slice(0, 4)}-${token}-${t}`,
  };
}

function memeBook(wallet: string, start: number): DexTrade[] {
  const tokens = ['tokA', 'tokB', 'tokC', 'tokD', 'tokE', 'tokF'];
  const out: DexTrade[] = [];
  tokens.forEach((token, i) => {
    const t0 = start + i * 86_400_000;
    out.push(buy(wallet, token, t0, 1, 80, 60_000 + i * 1000));
    out.push(buy('otherEarly', token, t0 + 120_000, 1.05, 50, 70_000));
    out.push(buy('late', token, t0 + 3_600_000, 1.8, 200, 400_000));
    out.push(sell(wallet, token, t0 + 45 * 60_000, 1.55, 120));
  });
  return out;
}

describe('pairRoundTrips', () => {
  it('FIFO-matches buys and sells without using future fills', () => {
    const trades: DexTrade[] = [
      buy(W1, 'm', 1000, 1, 100),
      buy(W1, 'm', 2000, 2, 100),
      sell(W1, 'm', 3000, 3, 150),
    ];
    const { closed, open } = pairRoundTrips(trades);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.entryPrice).toBe(1);
    expect(closed[0]?.pnl).toBeGreaterThan(0);
    expect(open.length).toBeGreaterThan(0);
  });
});

describe('wallet scoring', () => {
  it('does not rank a whale above an early meme trader just because PnL is larger', () => {
    const early = memeBook(W1, 1_700_000_000_000);
    const whale: DexTrade[] = [
      buy(W2, 'solish', 1_700_000_000_000, 100, 50_000, 80_000_000),
      sell(W2, 'solish', 1_700_000_000_000 + 86_400_000, 110, 55_000),
    ];
    const now = 1_700_000_000_000 + 10 * 86_400_000;
    const earlyStats = computeWalletStats(W1, early, now);
    const whaleStats = computeWalletStats(W2, whale, now);
    const earlyScore = scoreWallet(earlyStats).score;
    const whaleScore = scoreWallet(whaleStats).score;
    expect(earlyStats.realizedPnl).toBeLessThan(whaleStats.realizedPnl);
    expect(earlyScore).toBeGreaterThan(whaleScore);
    expect(classifyWallet({ score: earlyScore, stats: earlyStats, excluded: false })).not.toBe(
      WalletTier.D,
    );
  });

  it('uses only closed trades known at asOf (no look-ahead)', () => {
    const trades: DexTrade[] = [
      buy(W1, 'a', 100, 1, 50, 50_000),
      sell(W1, 'a', 200, 2, 90),
      buy(W1, 'b', 300, 1, 50, 50_000),
      sell(W1, 'b', 800, 3, 140),
    ];
    const beforeSecondExit = computeWalletStats(W1, trades, 500);
    expect(beforeSecondExit.totalTrades).toBe(1);
    expect(beforeSecondExit.winningTrades).toBe(1);
    const after = computeWalletStats(W1, trades, 900);
    expect(after.totalTrades).toBe(2);
  });
});

describe('exclusion and clustering', () => {
  it('flags sniper-only wallets', () => {
    const trades: DexTrade[] = [];
    for (let i = 0; i < 6; i++) {
      trades.push(buy(W1, `t${i}`, i * 10_000, 1, 20, 40_000));
      trades.push(sell(W1, `t${i}`, i * 10_000 + 8_000, 1.2, 24));
    }
    const stats = computeWalletStats(W1, trades, 100_000);
    const ex = evaluateExclusions({ address: W1, stats, trades });
    expect(ex.flags).toContain('SNIPER');
  });

  it('clusters copy-trade wallets so they are not independent', () => {
    const t0 = 1_000_000;
    const trades: DexTrade[] = [];
    for (const tok of ['a', 'b', 'c', 'd']) {
      trades.push(buy(W1, tok, t0, 1, 40, 50_000));
      trades.push(buy(COPY, tok, t0 + 2000, 1, 40, 50_000));
    }
    const clusters = clusterWallets(trades);
    expect(clusters.some((c) => c.wallets.includes(W1) && c.wallets.includes(COPY))).toBe(true);
  });
});

describe('consensus', () => {
  it('requires multiple independent A/B wallets in a short window', () => {
    const now = Date.now();
    const mk = (address: string, score: number, tier: WalletTier): ScoredWallet => ({
      address,
      smartScore: score,
      tier,
      stats: computeWalletStats(address, [], now),
      components: {
        roiPnl: score,
        winRate: score,
        earlyEntry: score,
        consistency: score,
        riskAdjusted: score,
        memeCalls: score,
        exitQuality: score,
        longevity: score,
      },
      excluded: false,
      excludeReasons: [],
      influence: tierInfluence(tier),
    });
    const wallets = [
      mk(W1, 92, WalletTier.A),
      mk(W2, 90, WalletTier.A),
      mk(W3, 88, WalletTier.A),
      mk(W4, 80, WalletTier.B),
    ];
    const event = detectConsensus({
      token: 'mint',
      symbol: 'TEST',
      wallets,
      buys: [
        { address: W1, token: 'mint', buyTime: now, usdValue: 40, entryMarketCap: 90_000 },
        { address: W2, token: 'mint', buyTime: now + 60_000, usdValue: 50, entryMarketCap: 95_000 },
        { address: W3, token: 'mint', buyTime: now + 120_000, usdValue: 30, entryMarketCap: 100_000 },
        { address: W4, token: 'mint', buyTime: now + 180_000, usdValue: 20, entryMarketCap: 110_000 },
      ],
    });
    expect(event).not.toBeNull();
    expect(event!.independentWallets).toBe(4);
    expect(event!.tierA).toBe(3);
    expect(event!.strength).toBeGreaterThan(60);
  });
});

describe('meme coin score', () => {
  it('never treats a single wallet buy as a BUY and avoids <60', () => {
    const result = computeMemeCoinScore({
      consensus: null,
      token: {
        liquidityUsd: 12_000,
        liquidityGrowthPct: -30,
        top10Pct: 72,
        volume1m: 100,
        volume5m: 200,
        volume15m: 400,
        volume24h: 8_000,
        buys1m: 2,
        sells1m: 8,
        buys5m: 4,
        sells5m: 20,
        holderCount: 40,
        holderGrowthPct: -10,
        newWalletGrowthPct: 0,
        marketCap: 50_000,
        marketCapGrowthPct: -20,
        technical5m: 30,
        trend15mBullish: false,
        higherHighs: false,
        higherLows: false,
        breakout: false,
        volumeExpansion: false,
        hugeSingleCandle: true,
      },
      risk: {
        top10Pct: 72,
        liquidityUsd: 12_000,
        prevLiquidityUsd: 40_000,
        volume24h: 8_000,
        buys24h: 10,
        sells24h: 40,
        mintAuthorityActive: true,
      },
    });
    expect(result.overall).toBeLessThan(60);
    expect(result.level).toBe(MemeSignalLevel.AVOID);
    expect(result.canEmitBuy).toBe(false);
    expect(result.reason).toMatch(/not a copy-trade/i);
  });

  it('can reach a strong setup when consensus + structure + liquidity line up', () => {
    const now = Date.now();
    const result = computeMemeCoinScore({
      consensus: {
        token: 'mint',
        symbol: 'PEPE',
        independentWallets: 6,
        tierA: 4,
        tierB: 2,
        firstEntry: now,
        lastEntry: now + 6 * 60_000,
        windowMs: 6 * 60_000,
        strength: 92,
        buyers: [],
        reason: '4 Tier A and 2 Tier B wallets independently accumulated this token within 6 minutes',
      },
      token: {
        liquidityUsd: 250_000,
        liquidityGrowthPct: 20,
        top10Pct: 22,
        liquidityLockedOrBurned: true,
        volume1m: 40_000,
        volume5m: 90_000,
        volume15m: 160_000,
        volume24h: 800_000,
        buys1m: 40,
        sells1m: 12,
        buys5m: 90,
        sells5m: 30,
        holderCount: 900,
        holderGrowthPct: 12,
        newWalletGrowthPct: 15,
        marketCap: 400_000,
        marketCapGrowthPct: 18,
        technical5m: 82,
        trend15mBullish: true,
        higherHighs: true,
        higherLows: true,
        breakout: true,
        volumeExpansion: true,
      },
      risk: {
        top10Pct: 22,
        liquidityUsd: 250_000,
        volume24h: 800_000,
        buys24h: 900,
        sells24h: 400,
      },
    });
    expect(result.overall).toBeGreaterThanOrEqual(80);
    expect(result.canEmitBuy).toBe(true);
    expect([MemeSignalLevel.STRONG, MemeSignalLevel.VERY_STRONG]).toContain(result.level);
  });
});

describe('decay, backtest, alerts, risk', () => {
  it('lets recent deterioration pull the score down', () => {
    const start = Date.now() - 40 * 86_400_000;
    const good = memeBook(W1, start);
    const dump: DexTrade[] = [
      buy(W1, 'rug', Date.now() - 3_600_000, 1, 200, 90_000),
      sell(W1, 'rug', Date.now() - 1_800_000, 0.2, 40),
    ];
    const all = [...good, ...dump];
    const allTime = scoreWallet(computeWalletStats(W1, good, Date.now())).score;
    const decayed = decayedSmartScore(W1, all, Date.now()).score;
    expect(decayed).toBeLessThan(allTime + 1);
  });

  it('backtest walk-forward only uses trades known at each point', () => {
    const trades = memeBook(W1, 1_000_000);
    const bt = backtestWallet(W1, trades);
    expect(bt.walkForward.length).toBeGreaterThan(1);
    for (let i = 1; i < bt.walkForward.length; i++) {
      expect(bt.walkForward[i]!.asOf).toBeGreaterThanOrEqual(bt.walkForward[i - 1]!.asOf);
      expect(bt.walkForward[i]!.tradesKnown).toBeGreaterThanOrEqual(
        bt.walkForward[i - 1]!.tradesKnown,
      );
    }
  });

  it('formats a smart-money alert without promising a buy', () => {
    const msg = formatSmartMoneyAlert({
      symbol: 'TEST',
      mint: W1,
      overall: 94,
      level: MemeSignalLevel.VERY_STRONG,
      consensus: {
        token: W1,
        independentWallets: 7,
        tierA: 5,
        tierB: 2,
        firstEntry: 1,
        lastEntry: 2,
        windowMs: 360_000,
        strength: 94,
        buyers: [],
        reason: '5 high-quality wallets independently accumulated this token within 6 minutes',
      },
      liquidityUsd: 250_000,
      trend5m: 'Bullish',
      trend15m: 'Bullish',
      volumeChangePct: 40,
      holderGrowthPct: 8,
      buySellRatio: 2.1,
      risk: detectRisk({
        top10Pct: 20,
        liquidityUsd: 250_000,
        volume24h: 100_000,
        buys24h: 200,
        sells24h: 80,
      }),
    });
    expect(msg.title).toContain('SMART MONEY ALERT');
    expect(msg.body).toContain('not an automatic BUY');
    expect(msg.body).toContain('not financial advice');
  });
});
