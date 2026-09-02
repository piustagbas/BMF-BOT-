import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { analyzeFixture, cardMarketLines, diversifyRecommended, pickHighOddsMarket } from './analysis';
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
    eventMatchKey,
    namesClose,
    type RawEvent,
} from './football.provider';
import { bookmakerConfig, fetchThirdBookOdds, mergeOdds, unavailableBooks, warmOddsCatalog } from './odds.provider';
import { selectBookingLegs } from './booking';
import { h2hNote } from './matchStats';
import { MARKET_LABELS, isListedFootball, leagueCountry, leagueHeading, compareByMatchDay, isOnCalendarDay, topCountryRank } from './popular';
import { dateRangeForQuery, localDate } from './football-data.utils';
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

type FixturesBoardResult = {
  source: string;
  count: number;
  items: import('./types').FixtureSummary[];
  warning?: string;
  note?: string;
  disclaimer: string;
};

@Injectable()
export class BetBotService {
  private readonly logger = new Logger(BetBotService.name);
  private readonly slips = new Map<string, StoredSlip[]>();
  private readonly analysisCache = new Map<string, { at: number; data: FixtureAnalysis }>();
  private readonly fixturesCache = new Map<string, { at: number; data: FixturesBoardResult }>();
  private aiWarmInFlight = false;
  private static readonly ANALYSIS_TTL_MS = 30 * 60 * 1000;
  private static readonly FIXTURES_CACHE_TTL_MS = 5 * 60 * 1000;

  status() {
    const books = bookmakerConfig();
    return {
      providers: {
        sportmonks: process.env.SPORTMONKS_API_TOKEN?.trim() ? 'configured' : 'disabled',
        apiFootball: process.env.API_FOOTBALL_KEY?.trim() ? 'configured' : 'disabled',
        footballDataOrg: (process.env.FOOTBALL_DATA_API_KEY?.trim() || process.env.FOOTBALL_DATA_TOKEN?.trim())
          ? 'configured'
          : 'disabled',
      },
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
        liveScores: 'FotMob + SofaScore + Livescore JSON (HTML/ads blocked)',
      },
      ai: openaiConfigured()
        ? `ChatGPT (${openaiModel()}) searches forecast sources, reads both last-match cards, compares that to the stats model, then keeps the stronger pick`
        : 'Local two-team analyst (set OPENAI_API_KEY to use ChatGPT before the pick)',
      disclaimer: BET_DISCLAIMER,
    };
  }

  async fixtures(query: {
    q?: string;
    league?: string;
    popular?: string;
    date?: string;
    day?: string;
    kickoffFrom?: string;
    kickoffTo?: string;
  }) {
    const cacheKey = JSON.stringify(query);
    const hit = this.fixturesCache.get(cacheKey);
    if (hit && Date.now() - hit.at < BetBotService.FIXTURES_CACHE_TTL_MS) return hit.data;
    const data = await this.loadFixtures(query);
    this.fixturesCache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  private async loadFixtures(query: {
    q?: string;
    league?: string;
    popular?: string;
    date?: string;
    day?: string;
    kickoffFrom?: string;
    kickoffTo?: string;
  }): Promise<FixturesBoardResult> {
    try {
      const range = dateRangeForQuery({ date: query.date, day: query.day });
      const { source, items, warning } = await listFixtures({
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
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

  async liveBoard(query: { popular?: string; q?: string; league?: string; date?: string; day?: string }) {
    try {
      const { source, items } = await listLiveFixtures();
      let live = items;
      const dateRange = dateRangeForQuery({ date: query.date, day: query.day });
      if (dateRange.dateFrom) {
        live = live.filter((fixture) => localDate(fixture.kickoffUtc, dateRange.timezone) === dateRange.dateFrom);
      }
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
      return {
        source,
        liveCount: live.length,
        live,
        upcoming: [],
        note: live.length
          ? 'Live scores only — JSON feeds, ads blocked. Grouped by league.'
          : 'No live games right now. Pull to refresh.',
        disclaimer: BET_DISCLAIMER,
      };
    } catch (err) {
      this.logger.warn(`liveBoard failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return {
        source: 'none',
        liveCount: 0,
        live: [],
        upcoming: [],
        note: 'Live feed failed. Pull to refresh.',
        disclaimer: BET_DISCLAIMER,
      };
    }
  }

  private lookupAnalysis(id: string, llm: boolean, raw: RawEvent): FixtureAnalysis | null {
    const suffix = llm ? 'ai' : 'fast';
    const keys = [
      `${id}:${suffix}`,
      `${raw.id}:${suffix}`,
      `${eventMatchKey(raw.homeName, raw.awayName, raw.kickoffUtc)}:${suffix}`,
    ];
    const now = Date.now();
    for (const key of keys) {
      const hit = this.analysisCache.get(key);
      if (hit && now - hit.at < BetBotService.ANALYSIS_TTL_MS) return hit.data;
    }
    for (const [key, hit] of this.analysisCache) {
      if (!key.endsWith(`:${suffix}`) || now - hit.at >= BetBotService.ANALYSIS_TTL_MS) continue;
      const fx = hit.data.fixture;
      if (
        namesClose(fx.home.name, raw.homeName) &&
        namesClose(fx.away.name, raw.awayName) &&
        fx.kickoffUtc.slice(0, 10) === raw.kickoffUtc.slice(0, 10)
      ) {
        return hit.data;
      }
    }
    return null;
  }

  private rememberAnalysis(id: string, llm: boolean, raw: RawEvent, data: FixtureAnalysis) {
    const suffix = llm ? 'ai' : 'fast';
    const at = Date.now();
    const keys = new Set([
      `${id}:${suffix}`,
      `${raw.id}:${suffix}`,
      `${data.fixture.id}:${suffix}`,
      `${eventMatchKey(raw.homeName, raw.awayName, raw.kickoffUtc)}:${suffix}`,
      `${eventMatchKey(data.fixture.home.name, data.fixture.away.name, data.fixture.kickoffUtc)}:${suffix}`,
    ]);
    for (const key of keys) this.analysisCache.set(key, { at, data });
  }

  async analyze(id: string, opts?: { llm?: boolean }): Promise<FixtureAnalysis> {
    const llm = opts?.llm === true;
    let raw = await findRawEvent(id);
    if (!raw) {
      const { events } = await listRawFixtures({});
      raw = events.find((e) => e.id === id) ?? null;
    }
    if (!raw) throw new NotFoundException('Fixture not found');
    const cached = this.lookupAnalysis(id, llm, raw);
    if (cached) return cached;
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
    this.rememberAnalysis(id, llm, raw, analysis);
    return analysis;
  }

  async picks(query: {
    date?: string;
    day?: string;
    market?: string;
    risk?: string;
    minimumProbability?: number;
    minimumConfidence?: number;
  } = {}) {
    let { items } = await this.fixtures({ popular: 'all', ...query });
    if (!items.length) {
      const popularOnly = await this.fixtures({ ...query });
      items = popularOnly.items;
    }
    const upcoming = items;
    const todayCount = upcoming.filter((fixture) => isOnCalendarDay(fixture.kickoffUtc)).length;
    const featured = upcoming.filter(isRequestedTopLeague);
    const slice = analysisSlice(
      [...featured, ...upcoming.filter((fixture) => !featured.includes(fixture))],
      Math.max(80, todayCount, featured.length),
    );
    await warmOddsCatalog().catch(() => undefined);
    const settled = await mapSettled(slice, 6, (f) => this.analyze(f.id, { llm: false }));
    const aiWarming = openaiConfigured();
    if (aiWarming) {
      this.warmAiEnrichment(slice);
    }
    let analyzed: FixtureAnalysis[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') analyzed.push(r.value);
      else {
        this.logger.warn(
          `Skip pick ${slice[i]?.id}: ${r.reason instanceof Error ? r.reason.message : 'error'}`,
        );
      }
    });
    if (query.market || query.risk || query.minimumProbability != null || query.minimumConfidence != null) {
      const filtered: FixtureAnalysis[] = [];
      for (const analysis of analyzed) {
        const markets = analysis.markets.filter((market) =>
          (!query.market || market.market.toLowerCase() === query.market!.toLowerCase()) &&
          (!query.risk || market.riskLevel.toLowerCase() === query.risk!.toLowerCase()) &&
          (query.minimumProbability == null || market.modelProbability >= query.minimumProbability) &&
          (query.minimumConfidence == null || market.confidence >= query.minimumConfidence),
        );
        if (!markets.length) continue;
        const recommended = markets.find((market) => market.market === analysis.recommended?.market) ?? markets[0] ?? null;
        filtered.push({ ...analysis, markets, recommended });
      }
      analyzed = filtered;
    }
    const recommendedPicks = analyzed.filter((a) => a.recommended).map((a) => pickFromAnalysis(a));
    const bookingPicks = diversifyRecommended(analyzed)
      .filter((a) => a.recommended)
      .map((a) => pickFromAnalysis(a));
    const allMarkets = analyzed.flatMap((a) => a.markets.map((m) => pickFromAnalysis(a, m)));
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
    const byScoreThenDay = (
      a: { kickoffUtc: string; analysisScore?: number; confidence?: number },
      b: { kickoffUtc: string; analysisScore?: number; confidence?: number },
    ) => byScore(a, b) || compareByMatchDay(a.kickoffUtc, b.kickoffUtc);
    const avoidMap = new Map<
      string,
      {
        fixtureId: string;
        match: string;
        reasons: string[];
        country?: string;
        countryFlag?: string;
        league?: string;
        leagueHeading?: string;
      }
    >();
    for (const a of analyzed) {
      const rec = a.recommended;
      const score = rec?.analysisScore ?? rec?.safetyScore ?? 0;
      const meaningful = a.avoidReasons.filter((r) => !/starting XI not confirmed/i.test(r));
      const weak = !rec || rec.category === 'AVOID' || score < 70;
      if (!meaningful.length && !weak) continue;
      const pack = packFromAnalysis(a);
      const reasons = [
        ...meaningful,
        ...(rec?.category === 'AVOID' ? [rec.reason || rec.riskLevel || 'Avoid'] : []),
        ...(rec && score < 70 ? [`Safety ${score}% — below the 70% line`] : []),
        ...(!rec ? ['No qualified market on this fixture'] : []),
      ].filter(Boolean);
      avoidMap.set(a.fixture.id, {
        fixtureId: a.fixture.id,
        match: `${a.fixture.home.name} vs ${a.fixture.away.name}`,
        reasons: [...new Set(reasons)].slice(0, 4),
        country: pack.country,
        countryFlag: pack.countryFlag,
        league: a.fixture.league,
        leagueHeading: pack.leagueHeading,
      });
    }
    const avoid = [...avoidMap.values()];
    const popularPicks = recommendedPicks.filter((p) => p.popularMatch).sort(byScoreThenDay);
    const otherPicks = recommendedPicks.filter((p) => !p.popularMatch).sort(byScoreThenDay);
    const highFromCategory = qualified.filter((m) => m.category === 'HIGH_ODDS');
    const highFromStats = analyzed
      .map((a) => {
        const m = pickHighOddsMarket(a.markets);
        if (!m) return null;
        return pickFromAnalysis(a, m);
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const highOdds = (highFromStats.length ? highFromStats : highFromCategory)
      .filter((row, i, arr) => arr.findIndex((x) => x.fixtureId === row.fixtureId) === i)
      .sort(byScoreThenDay);
    const multiScore = analyzed
      .filter((a) => a.multiScore)
      .map((a) => {
        const pack = packFromAnalysis(a);
        const ms = a.multiScore!;
        return {
          ...pickFromAnalysis(a),
          market: ms.side === 'HOME' ? ('HOME_MULTISCORE' as const) : ('AWAY_MULTISCORE' as const),
          label: ms.label,
          modelProbability: ms.combinedProbability,
          impliedProbability: null,
          edgePct: null,
          confidence: Math.min(ms.combinedProbability, 88),
          analysedOdds: ms.analysedOdds,
          sampleDeliveryRate: null,
          sampleSize: 0,
          historicalNote: ms.reason,
          category: 'HIGH_ODDS' as const,
          riskLevel: 'Value',
          reason: ms.reason,
          whyQualified: ms.scores.map((s) => `${s.line} model ${s.probability}%`),
          mainRisk: 'Multi-score is a correct-score combo. High variance — confirm the box on Bet9ja/SportyBet.',
          sources: a.sources,
          odds: { bestBook: null, bestOdds: ms.analysedOdds, books: [] },
          deliveryRate: ms.combinedProbability,
          multiScore: ms,
          last5Home: pack.last5Home,
          last5Away: pack.last5Away,
          scoresHome: pack.scoresHome,
          scoresAway: pack.scoresAway,
        };
      })
      .sort(byScoreThenDay);
    const booking = selectBookingLegs(bookingPicks.length ? bookingPicks : allMarkets, 8, {
      trustInputMarkets: Boolean(bookingPicks.length),
    });
    const valueFallback = [...recommendedPicks]
      .sort((a, b) => {
        const oa = a.analysedOdds ?? a.odds.bestOdds ?? 0;
        const ob = b.analysedOdds ?? b.odds.bestOdds ?? 0;
        return ob - oa || byScore(a, b);
      })
      .slice(0, 16);
    const elitePool = (popularPicks.length ? popularPicks : recommendedPicks).slice().sort(byScoreThenDay);
    return {
      safest: [...recommendedPicks].sort(byScoreThenDay),
      popularPicks,
      otherPicks,
      bestValue: value.length ? value : valueFallback,
      highOdds,
      multiScore,
      elite: elitePool.slice(0, 16),
      avoid,
      booking,
      accumulators: booking.accumulators,
      daily100: booking.daily100,
      noBet: false,
      note: recommendedPicks.length
        ? aiWarming
          ? 'Stats picks are live. AI is refining top matches in the background — pull to refresh in ~30s for upgraded scores.'
          : 'Highest safety % is on every card. Safest tab lists the strongest picks first. You do not need to open a match to see the %.'
        : 'Waiting on fixture analysis. Pull to refresh.',
      aiWarming,
      disclaimer: BET_DISCLAIMER,
    };
  }

  async bookingSlip() {
    const p = await this.picks();
    return { ...p.booking, disclaimer: BET_DISCLAIMER };
  }

  /** Background ChatGPT pass — stats picks return immediately; AI upgrades cache for refresh. */
  private warmAiEnrichment(fixtures: import('./types').FixtureSummary[]) {
    if (!openaiConfigured() || this.aiWarmInFlight || !fixtures.length) return;
    this.aiWarmInFlight = true;
    const top = fixtures.slice(0, 24);
    void (async () => {
      try {
        await mapSettled(top, 2, (f) => this.analyze(f.id, { llm: true }));
        this.logger.log(`AI enrichment warmed for ${top.length} fixtures`);
      } catch (err) {
        this.logger.warn(
          `AI enrichment failed: ${err instanceof Error ? err.message : 'error'}`,
        );
      } finally {
        this.aiWarmInFlight = false;
      }
    })();
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
    cardLines: a.cardLines?.length ? a.cardLines : cardMarketLines(a),
  };
}

function isRequestedTopLeague(f: {
  league: string;
  country?: string;
  topLeague?: boolean;
}): boolean {
  const country = (f.country || leagueCountry(f.league)).trim().toLowerCase();
  const league = f.league.toLowerCase();
  return (
    f.topLeague === true &&
    (country === 'turkey' ||
      country === 'netherlands' ||
      country === 'portugal' ||
      /eredivisie|primeira liga|liga portugal|liga nos|super lig|superlig|trendyol/.test(league))
  );
}

function pickFromAnalysis(a: FixtureAnalysis, market = a.recommended) {
  const rec = market!;
  const pack = packFromAnalysis(a);
  return {
    ...rec,
    fixtureId: a.fixture.id,
    home: a.fixture.home.name,
    away: a.fixture.away.name,
    match: `${a.fixture.home.name} vs ${a.fixture.away.name}`,
    kickoffUtc: a.fixture.kickoffUtc,
    league: a.fixture.league,
    country: pack.country,
    countryFlag: pack.countryFlag,
    leagueHeading: pack.leagueHeading,
    popularMatch: a.fixture.popularMatch,
    deliveryRate: rec.sampleDeliveryRate ?? rec.modelProbability,
    analysedOdds: rec.analysedOdds,
    last5Home: pack.last5Home,
    last5Away: pack.last5Away,
    scoresHome: pack.scoresHome,
    scoresAway: pack.scoresAway,
    multiScore: pack.multiScore,
    aiSummary: a.ai?.summary,
    cardLines: pack.cardLines,
  };
}

function analysisSlice<
  T extends { kickoffUtc: string; popularMatch?: boolean; live?: boolean; topLeague?: boolean },
>(items: T[], cap: number): T[] {
  const rank = (f: T) => {
    const today = Boolean(f.live || isOnCalendarDay(f.kickoffUtc));
    const tomorrow = isOnCalendarDay(f.kickoffUtc, new Date(), 'tomorrow');
    if (today && f.topLeague) return 0;
    if (today && f.popularMatch) return 1;
    if (today) return 2;
    if (tomorrow && f.topLeague) return 3;
    if (tomorrow && f.popularMatch) return 4;
    if (tomorrow) return 5;
    if (f.topLeague) return 6;
    if (f.popularMatch) return 7;
    return 8;
  };
  return [...items]
    .sort(
      (a, b) =>
        rank(a) - rank(b) || compareByMatchDay(a.kickoffUtc, b.kickoffUtc) || a.kickoffUtc.localeCompare(b.kickoffUtc),
    )
    .slice(0, cap);
}

function byPopularThenLeague(
  a: {
    popularMatch?: boolean;
    topLeague?: boolean;
    country?: string;
    league: string;
    kickoffUtc: string;
    live?: boolean;
  },
  b: {
    popularMatch?: boolean;
    topLeague?: boolean;
    country?: string;
    league: string;
    kickoffUtc: string;
    live?: boolean;
  },
) {
  const day = compareByMatchDay(a.kickoffUtc, b.kickoffUtc);
  if (day) return day;
  if (Boolean(a.live) !== Boolean(b.live)) return a.live ? -1 : 1;
  if (Boolean(a.topLeague) !== Boolean(b.topLeague)) return a.topLeague ? -1 : 1;
  const ca = topCountryRank(a.country || leagueCountry(a.league));
  const cb = topCountryRank(b.country || leagueCountry(b.league));
  if (ca !== cb) return ca - cb;
  if (Boolean(a.popularMatch) !== Boolean(b.popularMatch)) {
    return Number(Boolean(b.popularMatch)) - Number(Boolean(a.popularMatch));
  }
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
