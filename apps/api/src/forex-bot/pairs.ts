import { DEFAULT_FOREX_RISK, type PairSpec } from './types';

export const PAIRS: PairSpec[] = [
  pair('EURUSD', 'EUR', 'USD', 'EURUSD=X', 0.0001, 5, 100_000, 0.9, 1.8, 'MAJOR', [
    { symbol: 'GBPUSD', corr: 0.86 },
    { symbol: 'USDCHF', corr: -0.82 },
    { symbol: 'EURJPY', corr: 0.72 },
    { symbol: 'AUDUSD', corr: 0.55 },
  ]),
  pair('GBPUSD', 'GBP', 'USD', 'GBPUSD=X', 0.0001, 5, 100_000, 1.2, 2.4, 'MAJOR', [
    { symbol: 'EURUSD', corr: 0.86 },
    { symbol: 'USDCHF', corr: -0.7 },
    { symbol: 'GBPJPY', corr: 0.68 },
  ]),
  pair('USDJPY', 'USD', 'JPY', 'USDJPY=X', 0.01, 3, 100_000, 1.1, 2.2, 'MAJOR', [
    { symbol: 'USDCHF', corr: 0.58 },
    { symbol: 'EURJPY', corr: 0.64 },
    { symbol: 'XAUUSD', corr: -0.42 },
  ]),
  pair('USDCHF', 'USD', 'CHF', 'USDCHF=X', 0.0001, 5, 100_000, 1.4, 2.6, 'MAJOR', [
    { symbol: 'EURUSD', corr: -0.82 },
    { symbol: 'GBPUSD', corr: -0.7 },
    { symbol: 'USDJPY', corr: 0.58 },
  ]),
  pair('AUDUSD', 'AUD', 'USD', 'AUDUSD=X', 0.0001, 5, 100_000, 1.1, 2.2, 'MAJOR', [
    { symbol: 'NZDUSD', corr: 0.9 },
    { symbol: 'EURUSD', corr: 0.55 },
    { symbol: 'XAUUSD', corr: 0.48 },
  ]),
  pair('USDCAD', 'USD', 'CAD', 'USDCAD=X', 0.0001, 5, 100_000, 1.3, 2.5, 'MAJOR', [
    { symbol: 'AUDUSD', corr: -0.52 },
    { symbol: 'NZDUSD', corr: -0.45 },
  ]),
  pair('NZDUSD', 'NZD', 'USD', 'NZDUSD=X', 0.0001, 5, 100_000, 1.4, 2.8, 'MAJOR', [
    { symbol: 'AUDUSD', corr: 0.9 },
  ]),
  pair('EURGBP', 'EUR', 'GBP', 'EURGBP=X', 0.0001, 5, 100_000, 1.3, 2.5, 'CROSS', [
    { symbol: 'EURUSD', corr: 0.38 },
    { symbol: 'GBPUSD', corr: -0.55 },
  ]),
  pair('EURJPY', 'EUR', 'JPY', 'EURJPY=X', 0.01, 3, 100_000, 1.6, 3.2, 'CROSS', [
    { symbol: 'EURUSD', corr: 0.72 },
    { symbol: 'USDJPY', corr: 0.64 },
    { symbol: 'GBPJPY', corr: 0.78 },
  ]),
  pair('GBPJPY', 'GBP', 'JPY', 'GBPJPY=X', 0.01, 3, 100_000, 2.2, 4.5, 'CROSS', [
    { symbol: 'GBPUSD', corr: 0.68 },
    { symbol: 'EURJPY', corr: 0.78 },
  ]),
  pair('XAUUSD', 'XAU', 'USD', 'XAUUSD=X', 0.01, 2, 100, 18, 45, 'METAL', [
    { symbol: 'AUDUSD', corr: 0.48 },
    { symbol: 'USDJPY', corr: -0.42 },
  ]),
];

const BY_SYMBOL = new Map(PAIRS.map((p) => [p.symbol, p]));

function pair(
  symbol: string,
  base: string,
  quote: string,
  yahoo: string,
  pipSize: number,
  digits: number,
  contractSize: number,
  typicalSpreadPips: number,
  maxSpreadPips: number,
  assetClass: PairSpec['assetClass'],
  correlatedWith: PairSpec['correlatedWith'],
): PairSpec {
  return {
    symbol,
    base,
    quote,
    yahoo,
    pipSize,
    digits,
    contractSize,
    typicalSpreadPips,
    maxSpreadPips,
    assetClass,
    correlatedWith,
  };
}

export function getPair(symbol: string): PairSpec {
  const p = BY_SYMBOL.get(symbol.toUpperCase());
  if (!p) throw new Error(`Unknown pair ${symbol}`);
  return p;
}

export function pipsBetween(spec: PairSpec, a: number, b: number): number {
  return Math.abs(b - a) / spec.pipSize;
}

export function roundPrice(spec: PairSpec, price: number): number {
  return Number(price.toFixed(spec.digits));
}

/** USD value of one pip for the given lot size. */
export function pipValueUsd(
  spec: PairSpec,
  price: number,
  lots: number,
  usdPerQuote?: number,
): number {
  const raw = spec.pipSize * spec.contractSize * lots;
  if (spec.quote === 'USD') return raw;
  if (spec.base === 'USD') return raw / price;
  const conv = usdPerQuote && usdPerQuote > 0 ? usdPerQuote : 1;
  return raw * conv;
}

export function lotsForRisk(opts: {
  spec: PairSpec;
  price: number;
  stopPips: number;
  balance: number;
  riskPct?: number;
  usdPerQuote?: number;
}): number {
  const riskPct = opts.riskPct ?? DEFAULT_FOREX_RISK.riskPerTradePct;
  const riskUsd = opts.balance * (riskPct / 100);
  if (opts.stopPips <= 0 || !Number.isFinite(opts.stopPips)) return DEFAULT_FOREX_RISK.minLots;
  const oneLotPip = pipValueUsd(opts.spec, opts.price, 1, opts.usdPerQuote);
  if (oneLotPip <= 0) return DEFAULT_FOREX_RISK.minLots;
  const raw = riskUsd / (opts.stopPips * oneLotPip);
  const stepped = Math.floor(raw * 100) / 100;
  return Math.min(
    DEFAULT_FOREX_RISK.maxLots,
    Math.max(DEFAULT_FOREX_RISK.minLots, stepped),
  );
}

export function pnlUsd(opts: {
  spec: PairSpec;
  side: 'BUY' | 'SELL';
  entry: number;
  exit: number;
  lots: number;
  usdPerQuote?: number;
}): number {
  const dir = opts.side === 'BUY' ? 1 : -1;
  const move = (opts.exit - opts.entry) * dir;
  const pips = move / opts.spec.pipSize;
  return pips * pipValueUsd(opts.spec, opts.exit, opts.lots, opts.usdPerQuote);
}

export function usdDirection(spec: PairSpec, side: 'BUY' | 'SELL'): number {
  if (spec.base === 'USD') return side === 'BUY' ? 1 : -1;
  if (spec.quote === 'USD') return side === 'BUY' ? -1 : 1;
  return 0;
}

export function pairCurrencies(spec: PairSpec): string[] {
  if (spec.base === 'XAU') return ['USD', 'XAU'];
  return [spec.base, spec.quote];
}
