import { fetchWithTimeout } from '@memecoinbot/data-providers';
import type { BetMarket, BookOdds, BookmakerId } from './types';

export type BookmakerConfig = {
  id: BookmakerId;
  label: string;
  oddsApiKey?: string;
};

export function bookmakerConfig(): BookmakerConfig[] {
  return [
    { id: 'bet9ja', label: process.env.BET_BOOK_1_LABEL || 'Bet9ja' },
    { id: 'sportybet', label: process.env.BET_BOOK_2_LABEL || 'SportyBet' },
    {
      id: 'third',
      label: process.env.BET_BOOK_3_LABEL || 'Guide book (The Odds API)',
      oddsApiKey: process.env.BET_BOOK_3_ODDS_KEY || undefined,
    },
  ];
}

const unavailableNote =
  'No official public odds API for this bookmaker. Prices are not invented. Check Bet9ja/SportyBet on the site.';

export function unavailableBooks(): BookOdds[] {
  return bookmakerConfig().map((b) => ({
    bookmaker: b.id,
    label: b.label,
    decimalOdds: null,
    available: false,
    note: unavailableNote,
  }));
}

const ODDS_SPORTS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_netherlands_eredivisie',
  'soccer_portugal_primeira_liga',
  'soccer_turkey_super_league',
  'soccer_uefa_champs_league',
  'soccer_uefa_europa_league',
];

type OddsEvent = {
  home: string;
  away: string;
  commence: string;
  prices: Partial<Record<BetMarket, number>>;
  bookKey: string;
};

type Catalog = { at: number; events: OddsEvent[] };
let catalog: Catalog | null = null;
const CATALOG_TTL = 10 * 60 * 1000;

function namesMatch(a: string, b: string): boolean {
  const canon = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\b(fc|cf|afc)\b/g, '')
      .replace(/^man /, 'manchester ')
      .replace(/\s+/g, ' ')
      .trim();
  const x = canon(a);
  const y = canon(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const xt = x.split(' ')[0] ?? x;
  const yt = y.split(' ')[0] ?? y;
  return xt.length >= 5 && yt.length >= 5 && (x.includes(yt) || y.includes(xt));
}

type GuideBook = {
  key: string;
  markets?: Array<{
    key: string;
    outcomes?: Array<{ name?: string; price?: number; point?: number }>;
  }>;
};

export function pickGuideBookmaker(books: GuideBook[], preferred?: string): GuideBook | undefined {
  if (preferred) {
    const hit = books.find((b) => b.key === preferred);
    if (hit) return hit;
  }
  return [...books].sort((a, b) => (b.markets?.length ?? 0) - (a.markets?.length ?? 0))[0];
}

export function pricesFromBook(bm: GuideBook, homeTeam: string, awayTeam: string): Partial<Record<BetMarket, number>> {
  const out: Partial<Record<BetMarket, number>> = {};
  for (const m of bm.markets ?? []) {
    if (m.key === 'h2h') {
      for (const o of m.outcomes ?? []) {
        const n = (o.name ?? '').toLowerCase();
        if (!o.price) continue;
        if (n === homeTeam.toLowerCase()) out.HOME = o.price;
        else if (n === awayTeam.toLowerCase()) out.AWAY = o.price;
        else if (n.includes('draw')) out.DRAW = o.price;
      }
    }
    if (m.key === 'totals') {
      for (const o of m.outcomes ?? []) {
        const n = (o.name ?? '').toLowerCase();
        const pt = o.point;
        const price = o.price;
        if (!price || pt == null) continue;
        if (n === 'over' && pt === 0.5) out.OVER_0_5 = price;
        if (n === 'over' && pt === 1.5) out.OVER_1_5 = price;
        if (n === 'under' && pt === 1.5) out.UNDER_1_5 = price;
        if (n === 'over' && pt === 2.5) out.OVER_2_5 = price;
        if (n === 'under' && pt === 2.5) out.UNDER_2_5 = price;
        if (n === 'over' && pt === 3.5) out.OVER_3_5 = price;
        if (n === 'under' && pt === 3.5) out.UNDER_3_5 = price;
      }
    }
    if (m.key === 'btts') {
      for (const o of m.outcomes ?? []) {
        const n = (o.name ?? '').toLowerCase();
        if (!o.price) continue;
        if (n === 'yes') out.BTTS_YES = o.price;
        if (n === 'no') out.BTTS_NO = o.price;
      }
    }
  }
  Object.assign(out, deriveComboMarkets(out));
  return out;
}

/** Double-chance / home-to-score guides from 1X2 — not Bet9ja prices. */
export function deriveComboMarkets(
  p: Partial<Record<BetMarket, number>>,
): Partial<Record<BetMarket, number>> {
  const extra: Partial<Record<BetMarket, number>> = {};
  if (p.HOME && p.DRAW && p.AWAY) {
    const ih = 1 / p.HOME;
    const id = 1 / p.DRAW;
    const ia = 1 / p.AWAY;
    const sum = ih + id + ia;
    extra.DC_1X = Math.round((1 / ((ih + id) / sum)) * 100) / 100;
    extra.DC_X2 = Math.round((1 / ((ia + id) / sum)) * 100) / 100;
    extra.DC_12 = Math.round((1 / ((ih + ia) / sum)) * 100) / 100;
  }
  return extra;
}

export function matchCatalogEvent(
  events: OddsEvent[],
  home: string,
  away: string,
): OddsEvent | undefined {
  return events.find((e) => namesMatch(e.home, home) && namesMatch(e.away, away));
}

async function loadCatalog(): Promise<OddsEvent[]> {
  const key = process.env.ODDS_API_KEY?.trim();
  if (!key) return [];
  if (catalog && Date.now() - catalog.at < CATALOG_TTL) return catalog.events;
  const region = process.env.ODDS_API_REGIONS || 'uk,eu';
  const preferred = process.env.ODDS_API_BOOKMAKER?.trim();
  const settled = await Promise.allSettled(
    ODDS_SPORTS.map(async (sport) => {
      const url =
        `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${encodeURIComponent(key)}` +
        `&regions=${encodeURIComponent(region)}&markets=h2h,totals&oddsFormat=decimal`;
      const res = await fetchWithTimeout(url, {}, 12000);
      if (!res.ok) return [] as OddsEvent[];
      const rows = (await res.json()) as Array<{
        home_team?: string;
        away_team?: string;
        commence_time?: string;
        bookmakers?: Array<{
          key: string;
          markets?: Array<{
            key: string;
            outcomes?: Array<{ name?: string; price?: number; point?: number }>;
          }>;
        }>;
      }>;
      const out: OddsEvent[] = [];
      for (const ev of rows) {
        if (!ev.home_team || !ev.away_team) continue;
        const bm = pickGuideBookmaker(ev.bookmakers ?? [], preferred);
        if (!bm) continue;
        out.push({
          home: ev.home_team,
          away: ev.away_team,
          commence: ev.commence_time ?? '',
          prices: pricesFromBook(bm, ev.home_team, ev.away_team),
          bookKey: bm.key,
        });
      }
      return out;
    }),
  );
  const events: OddsEvent[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') events.push(...r.value);
  }
  catalog = { at: Date.now(), events };
  return events;
}

export async function warmOddsCatalog(): Promise<void> {
  await loadCatalog();
}

/**
 * Guide prices from The Odds API (UK/EU books). Never treated as Bet9ja/SportyBet odds.
 */
export async function fetchThirdBookOdds(params: {
  home: string;
  away: string;
  kickoffUtc: string;
}): Promise<Partial<Record<BetMarket, number>> | null> {
  if (!process.env.ODDS_API_KEY?.trim()) return null;
  try {
    const events = await loadCatalog();
    const hit = matchCatalogEvent(events, params.home, params.away);
    if (!hit || !Object.keys(hit.prices).length) return null;
    return hit.prices;
  } catch {
    return null;
  }
}

export function mergeOdds(
  third: Partial<Record<BetMarket, number>> | null,
): Partial<Record<BetMarket, BookOdds[]>> {
  const books = bookmakerConfig();
  const markets = new Set<BetMarket>([
    'HOME',
    'DRAW',
    'AWAY',
    'DC_1X',
    'DC_X2',
    'DC_12',
    'OVER_0_5',
    'OVER_1_5',
    'OVER_2_5',
    'OVER_3_5',
    'UNDER_1_5',
    'UNDER_2_5',
    'UNDER_3_5',
    'BTTS_YES',
    'BTTS_NO',
    'HOME_TO_SCORE',
  ]);
  const result: Partial<Record<BetMarket, BookOdds[]>> = {};
  for (const market of markets) {
    result[market] = books.map((b) => {
      if (b.id === 'third' && third?.[market] != null) {
        return {
          bookmaker: b.id,
          label: b.label,
          decimalOdds: third[market]!,
          available: true,
          note: 'Guide price from The Odds API — not Bet9ja/SportyBet. Confirm on the site.',
        };
      }
      return {
        bookmaker: b.id,
        label: b.label,
        decimalOdds: null,
        available: false,
        note: unavailableNote,
      };
    });
  }
  return result;
}
