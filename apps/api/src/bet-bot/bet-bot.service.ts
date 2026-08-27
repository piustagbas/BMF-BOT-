import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { analyzeFixture, diversifyRecommended, pickHighOddsMarket } from './analysis';
import { analyseThenPick, openaiConfigured, openaiModel } from './aiAnalyst';
import {
  footballDataConfigured,
  listFixtures,
    listLiveFixtures,
    listRawFixtures,
    findRawEvent,
    loadLineup,
    loadTeamSnapshot,
    oddsApiConfigured,
    toFixtureSummary,
} from './football.provider';
import { bookmakerConfig, fetchThirdBookOdds, mergeOdds, unavailableBooks, warmOddsCatalog } from './odds.provider';
import { selectBookingLegs } from './booking';
import { h2hNote } from './matchStats';
import { MARKET_LABELS, isListedFootball, leagueCountry, leagueHeading, compareByMatchDay, localDayKey } from './popular';
import { BET_DISCLAIMER, type BookmakerId, type BetMarket, type FixtureAnalysis } from './types';

export type SlipSelection = {
  fixtureId: string;
  home: string;
  away: string;
  kickoffUtc: string;
  market: BetMarket;
  label: string;
  odds: number | null;
  bookmaker: BookmakerId;
  safetyScore: number;
  riskLevel: string;
};

type StoredSlip = {
  id: string;
  userId: string;
  bookmaker: BookmakerId;
  selections: SlipSelection[];
  combinedOdds: number | null;
  avgSafety: number;
  bookingCode: null;
  bookingStatus: 'MANUAL_ENTRY_REQUIRED';
  message: string;
  createdAt: string;
};

@Injectable()
export class BetBotService {
  private readonly logger = new Logger(BetBotService.name);
  private readonly slips = new Map<string, StoredSlip[]>();
  private readonly analysisCache = new Map<string, { at: number; data: FixtureAnalysis }>();

  status() {
    const books = bookmakerConfig();
    return {
      footballData: footballDataConfigured()
        ? 'football-data.org (merged with TheSportsDB)'
        : 'TheSportsDB public feed (no key needed)',
      oddsApi: oddsApiConfigured()
        ? 'The Odds API guide prices (not Bet9ja/SportyBet)'
        : 'model probabilities only — optional ODDS_API_KEY adds a third-book guide price',
      bookmakers: books.map((b) => ({
        id: b.id,
        label: b.label,
        oddsFeed:
          b.id === 'third' && oddsApiConfigured()
            ? 'The Odds API (guide only)'
            : 'no official Bet9ja/SportyBet feed — copy the slip onto the site',
      })),
      bookingCodes: 'Not fabricated. Copy the match list into Bet9ja or SportyBet and pick the markets shown.',
      feeds: {
        theSportsDb: 'active (fixtures + livescore)',
        footballData: footballDataConfigured() ? 'active' : 'optional token',
        oddsApi: oddsApiConfigured() ? 'active (guide odds + live scores)' : 'optional key',
      },
      ai: openaiConfigured()
        ? `ChatGPT (${openaiModel()}) analyses both teams, then picks the market`
        : 'Local two-team analyst (set OPENAI_API_KEY to use ChatGPT before the pick)',
      disclaimer: BET_DISCLAIMER,
    };
  }

  async fixtures(query: {
    q?: string;
    league?: string;
    popular?: string;
    date?: string;
    kickoffFrom?: string;
    kickoffTo?: string;
  }) {
    try {
      const date = query.date;
      const { source, items, warning } = await listFixtures({
        dateFrom: date,
        dateTo: date,
      });
      let rows = items.filter((f) => isListedFootball(f.league) || isListedFootball(f.competition));
      const popularOnly = query.popular === '1' || query.popular === 'true' || query.popular === 'only';
      if (query.league) {
        const lg = query.league.toLowerCase();
        rows = rows.filter((f) => f.league.toLowerCase().includes(lg) || f.competition.toLowerCase().includes(lg));
      }
      if (query.q) {
        const q = query.q.toLowerCase();
        rows = rows.filter(
          (f) =>
            f.home.name.toLowerCase().includes(q) ||
            f.away.name.toLowerCase().includes(q) ||
            f.league.toLowerCase().includes(q) ||
            (f.country ?? '').toLowerCase().includes(q),
        );
      } else if (popularOnly) {
        rows = rows.filter((f) => f.popularMatch);
      }
      if (query.kickoffFrom) {
        rows = rows.filter((f) => f.kickoffUtc >= query.kickoffFrom!);
      }
      if (query.kickoffTo) {
        rows = rows.filter((f) => f.kickoffUtc <= query.kickoffTo!);
      }
      rows.sort(byPopularThenLeague);
      return {
        source,
        count: rows.length,
        items: rows,
        warning,
        note: popularOnly
          ? 'Filter on: popular clubs only. Turn it off to see every country, popular and other leagues.'
          : 'Every country, popular and other leagues. Matches are grouped by day, then flag · country · league. Highest analysis scores sit at the top of each group.',
        disclaimer: BET_DISCLAIMER,
      };
    } catch (err) {
      this.logger.warn(`fixtures failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return {
        source: 'none',
        count: 0,
        items: [],
        warning: err instanceof Error ? err.message : 'Fixture feed failed. Try again shortly.',
        note: 'Could not load fixtures from the public football feeds.',
        disclaimer: BET_DISCLAIMER,
      };
    }
  }

  async liveBoard(query: { popular?: string; q?: string; league?: string }) {
    try {
      const { source, items } = await listLiveFixtures();
      let live = items;
      const popularOnly = query.popular === '1' || query.popular === 'true' || query.popular === 'only';
      if (query.league) {
        const lg = query.league.toLowerCase();
        live = live.filter(
          (f) => f.league.toLowerCase().includes(lg) || f.competition.toLowerCase().includes(lg),
        );
      }
      if (query.q) {
        const q = query.q.toLowerCase();
        live = live.filter(
          (f) =>
            f.home.name.toLowerCase().includes(q) ||
            f.away.name.toLowerCase().includes(q) ||
            f.league.toLowerCase().includes(q),
        );
      } else if (popularOnly) {
        live = live.filter((f) => f.popularMatch);
      }
      live.sort(byPopularThenLeague);
      let upcoming = (await this.fixtures({ popular: 'all', q: query.q, league: query.league }))
        .items.filter((f) => !f.live);
      if (popularOnly) {
        upcoming = upcoming.filter((f) => f.popularMatch);
      }
      return {
        source,
        liveCount: live.length,
        live,
        upcoming,
        note: live.length
          ? 'Live scores from public feeds. Every country is listed — popular and other leagues — with the flag on each card.'
          : upcoming.length
            ? `No live games right now. ${upcoming.length} upcoming matches listed below, all countries, Popular then Other.`
            : 'No live games right now. Upcoming matches load from TheSportsDB + OpenLigaDB — pull to refresh.',
        disclaimer: BET_DISCLAIMER,
      };
    } catch (err) {
      this.logger.warn(`liveBoard failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return {
        source: 'none',
        liveCount: 0,
        live: [],
        upcoming: [],
        note: 'Live feed failed. Upcoming matches may still load on the Fixtures tab.',
        disclaimer: BET_DISCLAIMER,
      };
    }
  }

  async analyze(id: string, opts?: { llm?: boolean }): Promise<FixtureAnalysis> {
    const llm = opts?.llm !== false;
    const cacheKey = `${id}:${llm ? 'ai' : 'fast'}`;
    const hit = this.analysisCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 4 * 60 * 1000) return hit.data;
    let raw = await findRawEvent(id);
    if (!raw) {
      const { events } = await listRawFixtures({});
      raw = events.find((e) => e.id === id) ?? null;
    }
    if (!raw) throw new NotFoundException('Fixture not found');
    const summary = toFixtureSummary(raw);

    const [home, away, lineup] = await Promise.all([
      loadTeamSnapshot(raw.homeId, raw.homeName),
      loadTeamSnapshot(raw.awayId, raw.awayName),
      loadLineup(raw.id),
    ]);
    const third = await fetchThirdBookOdds({
      home: raw.homeName,
      away: raw.awayName,
      kickoffUtc: raw.kickoffUtc,
    });
    const oddsByMarket = mergeOdds(third);
    const importance = /champions|europa|final|cup/i.test(raw.league)
      ? 'High — cup/european fixture (rotation risk possible)'
      : 'League fixture';
    const stats = analyzeFixture({
      fixture: summary,
      home,
      away,
      h2hText: h2hNote(home, away),
      importance,
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsByMarket,
      oddsNote:
        'Bet9ja and SportyBet have no official odds API. Guide prices are from The Odds API when ODDS_API_KEY is set. Always confirm the price on the betting site.',
    });
    const analysis = await analyseThenPick(stats, home, away, { llm });
    this.analysisCache.set(cacheKey, { at: Date.now(), data: analysis });
    if (raw.id !== id) this.analysisCache.set(`${raw.id}:${llm ? 'ai' : 'fast'}`, { at: Date.now(), data: analysis });
    return analysis;
  }

  async picks() {
    let { items } = await this.fixtures({ popular: 'all' });
    if (!items.length) {
      const popularOnly = await this.fixtures({});
      items = popularOnly.items;
    }
    const upcoming = items.filter((f) => !f.live);
    const slice = analysisSlice(upcoming, 96);
    await warmOddsCatalog().catch(() => undefined);
    const settled = await mapSettled(slice, 4, (f) => this.analyze(f.id, { llm: false }));
    const analyzed: FixtureAnalysis[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') analyzed.push(r.value);
      else {
        this.logger.warn(
          `Skip pick ${slice[i]?.id}: ${r.reason instanceof Error ? r.reason.message : 'error'}`,
        );
      }
    });
    const unique = diversifyRecommended(analyzed);
    const recommendedPicks = unique
      .filter((a) => a.recommended)
      .map((a) => {
        const pack = packFromAnalysis(a);
        return {
          ...a.recommended!,
          fixtureId: a.fixture.id,
          home: a.fixture.home.name,
          away: a.fixture.away.name,
          match: `${a.fixture.home.name} vs ${a.fixture.away.name}`,
          kickoffUtc: a.fixture.kickoffUtc,
          league: a.fixture.league,
          country: pack.country,
          leagueHeading: pack.leagueHeading,
          popularMatch: a.fixture.popularMatch,
          deliveryRate: a.recommended!.sampleDeliveryRate ?? a.recommended!.modelProbability,
          analysedOdds: a.recommended!.analysedOdds,
          last5Home: pack.last5Home,
          last5Away: pack.last5Away,
          scoresHome: pack.scoresHome,
          scoresAway: pack.scoresAway,
          multiScore: pack.multiScore,
          aiSummary: a.ai?.summary,
        };
      });
    const allMarkets = analyzed.flatMap((a) => {
      const pack = packFromAnalysis(a);
      return a.markets.map((m) => ({
        ...m,
        fixtureId: a.fixture.id,
        home: a.fixture.home.name,
        away: a.fixture.away.name,
        match: `${a.fixture.home.name} vs ${a.fixture.away.name}`,
        kickoffUtc: a.fixture.kickoffUtc,
        league: a.fixture.league,
        country: pack.country,
        leagueHeading: pack.leagueHeading,
        popularMatch: a.fixture.popularMatch,
        deliveryRate: m.sampleDeliveryRate ?? m.modelProbability,
        analysedOdds: m.analysedOdds,
        last5Home: pack.last5Home,
        last5Away: pack.last5Away,
        scoresHome: pack.scoresHome,
        scoresAway: pack.scoresAway,
        aiSummary: a.ai?.summary,
      }));
    });
    const qualified = [
      ...allMarkets.filter((m) => m.category !== 'AVOID'),
      ...recommendedPicks.filter((r) => !allMarkets.some((m) => m.fixtureId === r.fixtureId && m.market === r.market && m.category !== 'AVOID')),
    ];
    const byScore = (
      a: { analysisScore?: number; confidence?: number },
      b: { analysisScore?: number; confidence?: number },
    ) =>
      (b.analysisScore ?? 0) - (a.analysisScore ?? 0) || (b.confidence ?? 0) - (a.confidence ?? 0);
    const value = qualified.filter((m) => m.category === 'BEST_VALUE').sort(byScore).slice(0, 16);
    const avoid = analyzed
      .filter((a) => a.avoidReasons.length > 0)
      .map((a) => ({
        fixtureId: a.fixture.id,
        match: `${a.fixture.home.name} vs ${a.fixture.away.name}`,
        reasons: a.avoidReasons,
      }));
    const byDayThenScore = (
      a: { kickoffUtc: string; analysisScore?: number; confidence?: number },
      b: { kickoffUtc: string; analysisScore?: number; confidence?: number },
    ) => compareByMatchDay(a.kickoffUtc, b.kickoffUtc) || byScore(a, b);
    const popularPicks = recommendedPicks.filter((p) => p.popularMatch).sort(byDayThenScore);
    const otherPicks = recommendedPicks.filter((p) => !p.popularMatch).sort(byDayThenScore);
    const highFromCategory = qualified.filter((m) => m.category === 'HIGH_ODDS');
    const highFromStats = unique
      .map((a) => {
        const m = pickHighOddsMarket(a.markets);
        if (!m) return null;
        const pack = packFromAnalysis(a);
        return {
          ...m,
          fixtureId: a.fixture.id,
          home: a.fixture.home.name,
          away: a.fixture.away.name,
          match: `${a.fixture.home.name} vs ${a.fixture.away.name}`,
          kickoffUtc: a.fixture.kickoffUtc,
          league: a.fixture.league,
          country: pack.country,
          leagueHeading: pack.leagueHeading,
          popularMatch: a.fixture.popularMatch,
          deliveryRate: m.sampleDeliveryRate ?? m.modelProbability,
          analysedOdds: m.analysedOdds,
          last5Home: pack.last5Home,
          last5Away: pack.last5Away,
          scoresHome: pack.scoresHome,
          scoresAway: pack.scoresAway,
          multiScore: pack.multiScore,
          aiSummary: a.ai?.summary,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const highOdds = (highFromStats.length ? highFromStats : highFromCategory)
      .filter((row, i, arr) => arr.findIndex((x) => x.fixtureId === row.fixtureId) === i)
      .sort(byDayThenScore);
    const multiScore = unique
      .filter((a) => a.multiScore)
      .map((a) => {
        const pack = packFromAnalysis(a);
        const ms = a.multiScore!;
        return {
          market: ms.side === 'HOME' ? ('HOME_MULTISCORE' as const) : ('AWAY_MULTISCORE' as const),
          label: ms.label,
          modelProbability: ms.combinedProbability,
          impliedProbability: null,
          edgePct: null,
          safetyScore: a.recommended?.safetyScore ?? 60,
          analysisScore: a.recommended?.analysisScore ?? 60,
          confidence: Math.min(ms.combinedProbability, 88),
          analysedOdds: ms.analysedOdds,
          sampleDeliveryRate: null,
          sampleSize: 0,
          historicalNote: ms.reason,
          category: 'HIGH_ODDS',
          riskLevel: 'Value',
          reason: ms.reason,
          whyQualified: ms.scores.map((s) => `${s.line} model ${s.probability}%`),
          mainRisk: 'Multi-score is a correct-score combo. High variance — confirm the box on Bet9ja/SportyBet.',
          sources: a.sources,
          odds: { bestBook: null, bestOdds: ms.analysedOdds, books: [] },
          fixtureId: a.fixture.id,
          home: a.fixture.home.name,
          away: a.fixture.away.name,
          match: `${a.fixture.home.name} vs ${a.fixture.away.name}`,
          kickoffUtc: a.fixture.kickoffUtc,
          league: a.fixture.league,
          country: pack.country,
          leagueHeading: pack.leagueHeading,
          popularMatch: a.fixture.popularMatch,
          deliveryRate: ms.combinedProbability,
          last5Home: pack.last5Home,
          last5Away: pack.last5Away,
          scoresHome: pack.scoresHome,
          scoresAway: pack.scoresAway,
          multiScore: ms,
          aiSummary: a.ai?.summary,
        };
      })
      .sort(byDayThenScore);
    const booking = selectBookingLegs(recommendedPicks.length ? recommendedPicks : allMarkets, 8, {
      trustInputMarkets: Boolean(recommendedPicks.length),
    });
    return {
      safest: [...recommendedPicks].sort(byDayThenScore),
      popularPicks,
      otherPicks,
      bestValue: value.length ? value : recommendedPicks.filter((m) => m.category === 'BEST_VALUE').sort(byDayThenScore).slice(0, 16),
      highOdds,
      multiScore,
      elite: popularPicks.slice(0, 16),
      avoid,
      booking,
      accumulators: booking.accumulators,
      daily100: booking.daily100,
      noBet: false,
      note: recommendedPicks.length
        ? `Every match is listed by day. Highest analysis scores are on the cards. Popular and other leagues from every country, with flags.`
        : 'Waiting on fixture analysis. Pull to refresh.',
      disclaimer: BET_DISCLAIMER,
    };
  }

  async bookingSlip() {
    const p = await this.picks();
    return { ...p.booking, disclaimer: BET_DISCLAIMER };
  }

  quoteSlip(userId: string, bookmaker: BookmakerId, selections: SlipSelection[]) {
    const odds = selections.map((s) => s.odds).filter((n): n is number => n != null && n > 1);
    const combinedOdds =
      odds.length === selections.length && odds.length
        ? Math.round(odds.reduce((a, b) => a * b, 1) * 100) / 100
        : null;
    const avgSafety =
      selections.length === 0
        ? 0
        : Math.round(
            (selections.reduce((a, s) => a + s.safetyScore, 0) / selections.length) * 10,
          ) / 10;
    const book = bookmakerConfig().find((b) => b.id === bookmaker);
    const slip: StoredSlip = {
      id: `slip_${Date.now()}`,
      userId,
      bookmaker,
      selections,
      combinedOdds,
      avgSafety,
      bookingCode: null,
      bookingStatus: 'MANUAL_ENTRY_REQUIRED',
      message:
        `${book?.label ?? bookmaker} has no official booking-code integration here. Copy the slip and enter it manually in the bookmaker app. A code is never invented.`,
      createdAt: new Date().toISOString(),
    };
    const list = this.slips.get(userId) ?? [];
    list.unshift(slip);
    this.slips.set(userId, list.slice(0, 30));
    return {
      ...slip,
      labels: selections.map((s) => MARKET_LABELS[s.market] ?? s.label),
      unavailableBooks: unavailableBooks(),
      disclaimer: BET_DISCLAIMER,
    };
  }

  listSlips(userId: string) {
    return { items: this.slips.get(userId) ?? [], count: (this.slips.get(userId) ?? []).length };
  }

  verifyTicket(input: {
    bookmaker: BookmakerId;
    bookingCode?: string;
    pastedSelections?: Array<{ match?: string; market?: string; odds?: number }>;
    botSelections: SlipSelection[];
  }) {
    const book = bookmakerConfig().find((b) => b.id === input.bookmaker);
    if (input.bookingCode?.trim() && !input.pastedSelections?.length) {
      return {
        supported: false,
        bookmaker: book?.label ?? input.bookmaker,
        bookingCode: input.bookingCode.trim(),
        message:
          'This bookmaker does not provide an official ticket-verify API in this app. Paste the slip selections to compare locally, or check the code in the bookmaker app. The code is not fetched or invented.',
        matching: [],
        missing: input.botSelections.map((s) => `${s.home} vs ${s.away} · ${s.label}`),
        changed: [],
        oddsChanges: [],
        fixtureDateDifferences: [],
        totalOddsBot: combined(input.botSelections),
        totalOddsTicket: null,
        disclaimer: BET_DISCLAIMER,
      };
    }
    const pasted = input.pastedSelections ?? [];
    const matching: string[] = [];
    const missing: string[] = [];
    const changed: string[] = [];
    const oddsChanges: string[] = [];
    for (const bot of input.botSelections) {
      const key = `${bot.home} vs ${bot.away}`.toLowerCase();
      const hit = pasted.find(
        (p) =>
          (p.match ?? '').toLowerCase().includes(bot.home.toLowerCase()) &&
          (p.match ?? '').toLowerCase().includes(bot.away.toLowerCase()) &&
          (p.market ?? '').toLowerCase().includes((bot.label ?? '').toLowerCase().slice(0, 8)),
      );
      if (!hit) {
        missing.push(`${bot.home} vs ${bot.away} · ${bot.label}`);
        continue;
      }
      matching.push(`${bot.home} vs ${bot.away} · ${bot.label}`);
      if (hit.odds != null && bot.odds != null && Math.abs(hit.odds - bot.odds) > 0.01) {
        oddsChanges.push(`${bot.label}: bot ${bot.odds} vs ticket ${hit.odds}`);
        changed.push(`${bot.home} vs ${bot.away} odds moved`);
      }
    }
    return {
      supported: true,
      mode: 'local_compare',
      bookmaker: book?.label ?? input.bookmaker,
      matching,
      missing,
      changed,
      oddsChanges,
      fixtureDateDifferences: [],
      totalOddsBot: combined(input.botSelections),
      totalOddsTicket: combinedPasted(pasted),
      disclaimer: BET_DISCLAIMER,
    };
  }
}

async function mapSettled<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i]!) };
      } catch (reason) {
        out[i] = { status: 'rejected', reason };
      }
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: items.length ? n : 0 }, () => worker()));
  return out;
}

function scoresLine(card?: { recent?: Array<{ gf: number; ga: number; opponent: string }> }): string {
  return (card?.recent ?? [])
    .slice(0, 5)
    .map((r) => `${r.gf}-${r.ga} ${r.opponent}`)
    .join(', ');
}

function packFromAnalysis(a: FixtureAnalysis) {
  const country = a.fixture.country || leagueCountry(a.fixture.league);
  return {
    country,
    countryFlag: a.fixture.countryFlag,
    leagueHeading: a.fixture.leagueHeading || leagueHeading(a.fixture.league, country),
    last5Home: a.teamStats.home.last5,
    last5Away: a.teamStats.away.last5,
    scoresHome: scoresLine(a.teamStats.home),
    scoresAway: scoresLine(a.teamStats.away),
    multiScore: a.multiScore,
  };
}

function analysisSlice<T extends { kickoffUtc: string; popularMatch?: boolean }>(items: T[], cap: number): T[] {
  const ranked = [...items].sort((a, b) => {
    const day = compareByMatchDay(a.kickoffUtc, b.kickoffUtc);
    if (day) return day;
    if (Boolean(a.popularMatch) !== Boolean(b.popularMatch)) {
      return Number(Boolean(b.popularMatch)) - Number(Boolean(a.popularMatch));
    }
    return a.kickoffUtc.localeCompare(b.kickoffUtc);
  });
  if (ranked.length <= cap) return ranked;
  const today = localDayKey();
  const todayItems = ranked.filter((f) => localDayKey(f.kickoffUtc) === today);
  if (todayItems.length >= cap) return todayItems.slice(0, cap);
  return ranked.slice(0, cap);
}

function byPopularThenLeague(
  a: { popularMatch?: boolean; country?: string; league: string; kickoffUtc: string; live?: boolean },
  b: { popularMatch?: boolean; country?: string; league: string; kickoffUtc: string; live?: boolean },
) {
  const day = compareByMatchDay(a.kickoffUtc, b.kickoffUtc);
  if (day) return day;
  if (Boolean(a.live) !== Boolean(b.live)) return a.live ? -1 : 1;
  if (Boolean(a.popularMatch) !== Boolean(b.popularMatch)) {
    return Number(Boolean(b.popularMatch)) - Number(Boolean(a.popularMatch));
  }
  const ca = (a.country || leagueCountry(a.league)).localeCompare(b.country || leagueCountry(b.league));
  if (ca) return ca;
  const lg = a.league.localeCompare(b.league);
  if (lg) return lg;
  return a.kickoffUtc.localeCompare(b.kickoffUtc);
}

function combined(sel: SlipSelection[]): number | null {
  const odds = sel.map((s) => s.odds).filter((n): n is number => n != null && n > 1);
  if (odds.length !== sel.length || !odds.length) return null;
  return Math.round(odds.reduce((a, b) => a * b, 1) * 100) / 100;
}

function combinedPasted(sel: Array<{ odds?: number }>): number | null {
  const odds = sel.map((s) => s.odds).filter((n): n is number => n != null && n > 1);
  if (odds.length !== sel.length || !odds.length) return null;
  return Math.round(odds.reduce((a, b) => a * b, 1) * 100) / 100;
}
