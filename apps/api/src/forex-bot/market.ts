import { atr, type Candle } from '@memecoinbot/indicators';
import { DEFAULT_FOREX_RISK, type FxCandle, type FxQuote, type PairSpec } from './types';
import { getPair, PAIRS, roundPrice } from './pairs';

const QUOTE_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (compatible; Memecoinbot-Forex/1.0; +https://github.com/memecoinbot)',
};

export type PairMarket = {
  spec: PairSpec;
  quote: FxQuote;
  candles: FxCandle[];
  atr: number | null;
  spike: boolean;
};

type CacheEntry = { at: number; markets: PairMarket[]; source: string };

let cache: CacheEntry | null = null;
const CACHE_MS = 12_000;

export function quoteAgeMs(timestamp: string, now = Date.now()): number {
  return Math.max(0, now - Date.parse(timestamp));
}

export function staleLimitMs(quote: FxQuote): number {
  return quote.source === 'yahoo-finance' ? DEFAULT_FOREX_RISK.yahooStaleMs : DEFAULT_FOREX_RISK.staleQuoteMs;
}

export function isQuoteStale(quote: FxQuote, now = Date.now()): boolean {
  return quoteAgeMs(quote.timestamp, now) > staleLimitMs(quote) || quote.stale;
}

export function applySpread(spec: PairSpec, mid: number): { bid: number; ask: number; spreadPips: number } {
  const half = (spec.typicalSpreadPips * spec.pipSize) / 2;
  return {
    bid: roundPrice(spec, mid - half),
    ask: roundPrice(spec, mid + half),
    spreadPips: spec.typicalSpreadPips,
  };
}

export function detectNewsSpike(candles: FxCandle[], atrValue: number | null): boolean {
  if (!atrValue || atrValue <= 0 || candles.length < 2) return false;
  const last = candles[candles.length - 1]!;
  const range = last.high - last.low;
  return range > atrValue * 2.5;
}

export function lastAtr(candles: FxCandle[]): number | null {
  if (candles.length < 16) return null;
  const mapped: Candle[] = candles.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
  const series = atr(mapped, 14);
  const v = series[series.length - 1];
  return v == null ? null : v;
}

export async function loadMarkets(now = new Date(), force = false): Promise<{
  markets: PairMarket[];
  source: string;
  fetchedAt: string;
}> {
  if (!force && cache && now.getTime() - cache.at < CACHE_MS) {
    return {
      markets: stampAges(cache.markets, now.getTime()),
      source: cache.source,
      fetchedAt: new Date(cache.at).toISOString(),
    };
  }
  const [live, spot] = await Promise.all([
    fetchYahooMarkets(now).catch(() => null),
    fetchSpotMarkets(now).catch(() => null),
  ]);
  const bySym = new Map<string, PairMarket>();
  for (const m of spot?.markets ?? []) bySym.set(m.spec.symbol, m);
  for (const m of live?.markets ?? []) bySym.set(m.spec.symbol, m);
  const markets = PAIRS.map((p) => bySym.get(p.symbol)).filter((m): m is PairMarket => !!m);
  if (!markets.length) {
    throw new Error('No FX feed responded — pull to refresh');
  }
  for (const m of markets) {
    if (m.candles.length < 40) {
      m.candles = synthCandles(m.spec, m.quote.mid, now);
      m.atr = lastAtr(m.candles);
      m.spike = false;
      m.quote.dataQuality = 'SYNTHETIC';
    }
  }
  const source = [
    live?.markets.length ? `Yahoo ${live.markets.length} pairs` : null,
    spot?.markets.length ? `spot ${spot.markets.length} pairs` : null,
  ]
    .filter(Boolean)
    .join(' + ');
  cache = { at: now.getTime(), markets, source };
  return { markets, source, fetchedAt: now.toISOString() };
}

function stampAges(markets: PairMarket[], nowMs: number): PairMarket[] {
  return markets.map((m) => {
    const ageMs = quoteAgeMs(m.quote.timestamp, nowMs);
    const stale = ageMs > staleLimitMs(m.quote) || m.quote.stale;
    return { ...m, quote: { ...m.quote, ageMs, stale } };
  });
}

async function fetchYahooMarkets(now: Date): Promise<{ markets: PairMarket[]; source: string }> {
  const results = await Promise.all(
    PAIRS.map(async (spec) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.yahoo)}?interval=15m&range=5d`;
        const res = await fetch(url, { headers: QUOTE_HEADERS, signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`yahoo ${spec.symbol} ${res.status}`);
        const json = (await res.json()) as {
          chart?: {
            result?: Array<{
              meta?: { regularMarketPrice?: number; regularMarketTime?: number };
              timestamp?: number[];
              indicators?: { quote?: Array<{ open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }> };
            }>;
          };
        };
        const result = json.chart?.result?.[0];
        const meta = result?.meta;
        const mid = meta?.regularMarketPrice;
        if (!mid || !Number.isFinite(mid)) throw new Error(`yahoo ${spec.symbol} no price`);
        const candles = parseYahooCandles(result);
        const lastCandleMs = candles.length ? candles[candles.length - 1]!.time : 0;
        const tsSec = meta.regularMarketTime ?? Math.floor(now.getTime() / 1000);
        const sourceMs = Math.max(tsSec * 1000, lastCandleMs);
        const timestamp = new Date(sourceMs || now.getTime()).toISOString();
        const { bid, ask, spreadPips } = applySpread(spec, mid);
        const atrValue = lastAtr(candles);
        const ageMs = quoteAgeMs(timestamp, now.getTime());
        const feedFresh = ageMs <= DEFAULT_FOREX_RISK.yahooStaleMs;
        const quote: FxQuote = {
          symbol: spec.symbol,
          bid,
          ask,
          mid: roundPrice(spec, mid),
          spreadPips,
          timestamp,
          ageMs,
          stale: !feedFresh,
          source: 'yahoo-finance',
          dataQuality:
            candles.length >= 40 && feedFresh ? 'LIVE' : candles.length >= 16 ? 'DEGRADED' : 'SYNTHETIC',
        };
        return {
          spec,
          quote,
          candles,
          atr: atrValue,
          spike: detectNewsSpike(candles, atrValue),
        } satisfies PairMarket;
      } catch {
        return null;
      }
    }),
  );
  const markets = results.filter((m): m is PairMarket => m != null);
  if (markets.length < 6) throw new Error('yahoo coverage');
  return { markets, source: 'Yahoo Finance 15m charts + typical bid/ask spread' };
}

function parseYahooCandles(result: {
  timestamp?: number[];
  indicators?: { quote?: Array<{ open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }> };
} | undefined): FxCandle[] {
  const ts = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0];
  const out: FxCandle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const open = q?.open?.[i];
    const high = q?.high?.[i];
    const low = q?.low?.[i];
    const close = q?.close?.[i];
    if (![open, high, low, close].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    out.push({
      time: ts[i]! * 1000,
      open: open!,
      high: high!,
      low: low!,
      close: close!,
      volume: q?.volume?.[i] ?? 0,
    });
  }
  return out.slice(-180);
}

export const FX_CHART_INTERVALS: Record<string, { interval: string; range: string }> = {
  '5m': { interval: '5m', range: '5d' },
  '15m': { interval: '15m', range: '5d' },
  '30m': { interval: '30m', range: '1mo' },
  '1h': { interval: '60m', range: '1mo' },
  '1d': { interval: '1d', range: '6mo' },
};

export function normalizeFxInterval(tf: string | undefined): string {
  if (tf === '60m' || tf === '1h') return '1h';
  if (tf && FX_CHART_INTERVALS[tf]) return tf;
  return '15m';
}

export function toChartCandles(candles: FxCandle[]): Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}> {
  return candles.map((c) => ({
    time: c.time > 1e12 ? Math.floor(c.time / 1000) : c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

type OhlcvCache = { at: number; candles: FxCandle[] };
const ohlcvCache = new Map<string, OhlcvCache>();
const OHLCV_CACHE_MS = 20_000;

export async function fetchYahooOhlcv(spec: PairSpec, timeframe: string, now = new Date()): Promise<FxCandle[]> {
  const tf = normalizeFxInterval(timeframe);
  const key = `${spec.symbol}:${tf}`;
  const hit = ohlcvCache.get(key);
  if (hit && now.getTime() - hit.at < OHLCV_CACHE_MS) return hit.candles;
  const specTf = FX_CHART_INTERVALS[tf] ?? FX_CHART_INTERVALS['15m']!;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.yahoo)}?interval=${specTf.interval}&range=${specTf.range}`;
  const res = await fetch(url, { headers: QUOTE_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`yahoo ${spec.symbol} ${tf} ${res.status}`);
  const json = (await res.json()) as {
    chart?: { result?: Array<Parameters<typeof parseYahooCandles>[0]> };
  };
  const candles = parseYahooCandles(json.chart?.result?.[0]).slice(-120);
  ohlcvCache.set(key, { at: now.getTime(), candles });
  return candles;
}

async function fetchSpotMarkets(now: Date): Promise<{ markets: PairMarket[]; source: string }> {
  const res = await fetch('https://open.er-api.com/v6/latest/USD', {
    headers: QUOTE_HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`fx ${res.status}`);
  const json = (await res.json()) as { result?: string; time_last_update_utc?: string; rates?: Record<string, number> };
  if (json.result !== 'success' || !json.rates) throw new Error('fx payload');
  const rates = json.rates;
  const markets: PairMarket[] = [];
  for (const spec of PAIRS) {
    const mid = midFromUsdRates(spec, rates);
    if (mid == null) continue;
    const { bid, ask, spreadPips } = applySpread(spec, mid);
    const ageMs = 0;
    const quote: FxQuote = {
      symbol: spec.symbol,
      bid,
      ask,
      mid: roundPrice(spec, mid),
      spreadPips,
      timestamp: now.toISOString(),
      ageMs,
      stale: false,
      source: 'open.er-api.com',
      dataQuality: 'SYNTHETIC',
    };
    const candles = synthCandles(spec, mid, now);
    const atrValue = lastAtr(candles);
    markets.push({ spec, quote, candles, atr: atrValue, spike: false });
  }
  if (markets.length < 6) throw new Error('fx coverage');
  return { markets, source: 'Daily FX mid (open.er-api.com) — degraded, not tick data' };
}

function midFromUsdRates(spec: PairSpec, usdRates: Record<string, number>): number | null {
  if (spec.base === 'XAU') {
    const gold = usdRates.XAU;
    if (gold && gold > 0) return 1 / gold;
    return null;
  }
  const basePerUsd = spec.base === 'USD' ? 1 : usdRates[spec.base];
  const quotePerUsd = spec.quote === 'USD' ? 1 : usdRates[spec.quote];
  if (!basePerUsd || !quotePerUsd) return null;
  const usdPerBase = spec.base === 'USD' ? 1 : 1 / basePerUsd;
  const usdPerQuote = spec.quote === 'USD' ? 1 : 1 / quotePerUsd;
  return usdPerBase / usdPerQuote;
}

export function synthCandles(spec: PairSpec, mid: number, now: Date, n = 90): FxCandle[] {
  let rnd = hash(`${spec.symbol}:${now.toISOString().slice(0, 13)}`);
  const next = () => {
    rnd = (Math.imul(1664525, rnd) + 1013904223) >>> 0;
    return rnd / 0xffffffff * 2 - 1;
  };
  const vol = spec.pipSize * 8;
  const drift = next() * spec.pipSize * 0.35;
  let p = mid - drift * n;
  const out: FxCandle[] = [];
  for (let i = 0; i < n; i++) {
    const open = p;
    p += drift + next() * vol;
    const close = i === n - 1 ? mid : p;
    p = close;
    out.push({
      time: now.getTime() - (n - i) * 900_000,
      open,
      high: Math.max(open, close) + Math.abs(next()) * vol,
      low: Math.min(open, close) - Math.abs(next()) * vol,
      close,
      volume: 1000,
    });
  }
  return out;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function refreshQuote(market: PairMarket, now = new Date()): FxQuote {
  const ageMs = quoteAgeMs(market.quote.timestamp, now.getTime());
  return {
    ...market.quote,
    ageMs,
    stale: ageMs > staleLimitMs(market.quote) || market.quote.stale,
  };
}

export function getCachedPair(symbol: string): PairMarket | undefined {
  return cache?.markets.find((m) => m.spec.symbol === symbol);
}

export function injectMarketsForTests(markets: PairMarket[], at = Date.now()) {
  cache = { at, markets, source: 'test' };
}

export { getPair };
