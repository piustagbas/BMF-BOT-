import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  fetchBetFixtures,
  fetchBetLiveFixtures,
  fetchBetPicks,
  fetchBetStatus,
  type BetAccumulator,
  type BetBookingLeg,
  type BetFixture,
  type BetPickRow,
} from '../../api/client';
import { betMatchKey, lookupBetCardAnalysis, rememberBetPick } from '../../bet/betAnalysisCache';
import { useBetSlip } from '../../bet/BetSlipContext';
import { StatusBadge } from '../../components/StatusBadge';
import { colors, common } from '../../theme';
import type { BetBotStackParamList } from '../../navigation/types';
import { BookmakerSlips } from './BookmakerSlips';
import { LiveScoreboard } from './LiveScoreboard';
import { MarketLines, SplitTeams, KickoffDate, betCardStyle, splitMatch, CountryLeagueLine } from './BetCardLayout';

type Props = NativeStackScreenProps<BetBotStackParamList, 'BetHome'>;
type Tab =
  | 'TODAY'
  | 'TOMORROW'
  | 'SAFEST'
  | 'MULTISCORE'
  | 'HIGH'
  | 'BOOKING'
  | 'LIVE'
  | 'FIXTURES'
  | 'VALUE'
  | 'ELITE'
  | 'ACCA'
  | 'AVOID';
function footballDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

type ListRow =
  | { key: string; kind: 'section'; title: string }
  | { key: string; kind: 'fixture'; fixture: BetFixture }
  | { key: string; kind: 'match'; fixture: BetFixture; pick?: BetPickRow; scoresFirst?: boolean }
  | { key: string; kind: 'pick'; pick: BetPickRow }
  | { key: string; kind: 'leg'; leg: BetBookingLeg }
  | {
      key: string;
      kind: 'avoid';
      fixtureId: string;
      match: string;
      reasons: string[];
      country?: string;
      countryFlag?: string;
      league?: string;
      leagueHeading?: string;
    }
  | { key: string; kind: 'acca'; title: string; row: BetAccumulator };

export function BetBotHomeScreen({ navigation }: Props) {
  const slip = useBetSlip();
  const [tab, setTab] = useState<Tab>('TODAY');
  const [q, setQ] = useState('');
  const [league, setLeague] = useState('');
  const [marketFilter, setMarketFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [minimumProbability, setMinimumProbability] = useState('');
  const [minimumConfidence, setMinimumConfidence] = useState('');
  const [popular, setPopular] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [fixtures, setFixtures] = useState<BetFixture[]>([]);
  const [todayFixtures, setTodayFixtures] = useState<BetFixture[]>([]);
  const [live, setLive] = useState<BetFixture[]>([]);
  const [upcoming, setUpcoming] = useState<BetFixture[]>([]);
  const [liveNote, setLiveNote] = useState('');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [picks, setPicks] = useState<Awaited<ReturnType<typeof fetchBetPicks>> | null>(null);
  const [picksLoading, setPicksLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [disclaimer, setDisclaimer] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fillBookingSlip = () => {
    const legs = picks?.booking?.legs ?? [];
    if (!legs.length) return;
    slip.replaceAll(
      legs.map((leg) => ({
        fixtureId: leg.fixtureId,
        home: leg.home,
        away: leg.away,
        kickoffUtc: leg.kickoffUtc,
        market: leg.market,
        label: leg.label,
        odds: leg.odds.bestOdds ?? leg.analysedOdds ?? null,
        bookmaker: slip.bookmaker,
        safetyScore: leg.analysisScore ?? leg.safetyScore,
        riskLevel: leg.riskLevel,
        cardLines: leg.cardLines,
      })),
    );
    navigation.navigate('BetSlip');
  };

  const fillDaily100 = () => {
    const legs = picks?.daily100?.legs ?? picks?.booking?.daily100?.legs ?? [];
    if (!legs.length) return;
    slip.replaceAll(
      legs.map((leg) => ({
        fixtureId: leg.fixtureId,
        home: leg.home,
        away: leg.away,
        kickoffUtc: leg.kickoffUtc,
        market: leg.market,
        label: leg.label,
        odds: leg.odds.bestOdds ?? leg.analysedOdds ?? null,
        bookmaker: slip.bookmaker,
        safetyScore: leg.analysisScore ?? leg.safetyScore,
        riskLevel: leg.riskLevel,
        cardLines: leg.cardLines,
      })),
    );
    navigation.navigate('BetSlip');
  };

  const [userRefreshing, setUserRefreshing] = useState(false);
  const [focusTick, setFocusTick] = useState(0);

  const rememberPicks = (nextPicks: NonNullable<typeof picks>) => {
    const pools = [...(nextPicks.safest ?? []), ...(nextPicks.popularPicks ?? []), ...(nextPicks.otherPicks ?? [])];
    for (const p of pools) rememberBetPick(p);
  };

  const load = useCallback(async (opts?: { background?: boolean }) => {
    const background = opts?.background === true;
    if (!background) {
      setLoading(true);
      setPicksLoading(true);
    }
    setError(null);
    const shared = {
      q: q.trim() || undefined,
      league: league.trim() || undefined,
      popular,
    };
    try {
      const [st, fxToday, board] = await Promise.all([
        fetchBetStatus().catch(() => null),
        fetchBetFixtures({ ...shared, day: 'today' }),
        fetchBetLiveFixtures({ ...shared, day: 'today' }).catch(() => null),
      ]);
      setTodayFixtures(fxToday.items);
      setFixtures(fxToday.items);
      setLive(board?.live ?? []);
      setUpcoming(board?.upcoming ?? []);
      setLiveNote(board?.note ?? '');
      setStatus(
        [st?.footballData, st?.oddsApi, st?.ai, st?.bookingCodes].filter(Boolean).join(' · '),
      );
      setDisclaimer(fxToday.disclaimer);
      setSource(board?.source || fxToday.source);
      setNote(fxToday.warning || fxToday.note || '');
      if (!background) setLoading(false);

      const [fxAll, nextPicks] = await Promise.all([
        fetchBetFixtures(shared).catch(() => null),
        fetchBetPicks({
          day: 'today',
          market: marketFilter.trim() || undefined,
          risk: riskFilter.trim() || undefined,
          minimumProbability: Number.isFinite(Number(minimumProbability)) && minimumProbability ? Number(minimumProbability) : undefined,
          minimumConfidence: Number.isFinite(Number(minimumConfidence)) && minimumConfidence ? Number(minimumConfidence) : undefined,
        }).catch(() => null),
      ]);
      if (fxAll?.items?.length) {
        const todayKey = footballDateKey(new Date());
        const todayFromAll = fxAll.items.filter(
          (f) => f.live || footballDateKey(new Date(f.kickoffUtc)) === todayKey,
        );
        const mergedToday = uniqueFixtures([...fxToday.items, ...todayFromAll]);
        setTodayFixtures(mergedToday);
        setFixtures(uniqueFixtures([...mergedToday, ...fxAll.items]));
      }
      if (nextPicks) {
        setPicks(nextPicks);
        rememberPicks(nextPicks);
      }
      if (nextPicks?.aiWarming) {
        setTimeout(() => {
          void fetchBetPicks({
            day: 'today',
            market: marketFilter.trim() || undefined,
            risk: riskFilter.trim() || undefined,
            minimumProbability:
              Number.isFinite(Number(minimumProbability)) && minimumProbability
                ? Number(minimumProbability)
                : undefined,
            minimumConfidence:
              Number.isFinite(Number(minimumConfidence)) && minimumConfidence
                ? Number(minimumConfidence)
                : undefined,
          })
            .then((refreshed) => {
              if (refreshed) {
                setPicks(refreshed);
                rememberPicks(refreshed);
              }
            })
            .catch(() => undefined);
        }, 30_000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fixtures');
      if (!background) setLoading(false);
    } finally {
      setPicksLoading(false);
      if (!background) setLoading(false);
    }
  }, [q, league, marketFilter, riskFilter, minimumProbability, minimumConfidence, popular]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const hasBoardDataRef = useRef(false);
  const fixturesReadyRef = useRef(false);
  const refreshLiveQuiet = useCallback(async () => {
    if (!fixturesReadyRef.current) return;
    try {
      const board = await fetchBetLiveFixtures({
        q: q.trim() || undefined,
        league: league.trim() || undefined,
        popular,
        day: 'today',
      });
      setLive(board?.live ?? []);
      setUpcoming(board?.upcoming ?? []);
      setLiveNote(board?.note ?? '');
      if (board?.source) setSource(board.source);
    } catch {
      /* keep last live board */
    }
  }, [q, league, popular]);
  const quietRef = useRef(refreshLiveQuiet);
  quietRef.current = refreshLiveQuiet;
  useFocusEffect(
    useCallback(() => {
      setFocusTick((n) => n + 1);
      void loadRef.current({ background: hasBoardDataRef.current }).finally(() => {
        fixturesReadyRef.current = true;
        hasBoardDataRef.current = true;
      });
      const tick = setInterval(() => {
        void quietRef.current();
      }, 25000);
      return () => clearInterval(tick);
    }, []),
  );

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'TODAY', label: 'Today' },
    { key: 'TOMORROW', label: 'Tomorrow' },
    { key: 'SAFEST', label: 'Safest' },
    { key: 'MULTISCORE', label: 'Multiscore' },
    { key: 'HIGH', label: 'High odds' },
    { key: 'BOOKING', label: 'Slips' },
    { key: 'LIVE', label: 'Live' },
    { key: 'FIXTURES', label: 'Fixtures' },
    { key: 'VALUE', label: 'Value' },
    { key: 'ELITE', label: 'Elite' },
    { key: 'ACCA', label: 'Acca' },
    { key: 'AVOID', label: 'Avoid' },
  ];

  const selectTab = (nextTab: Tab) => {
    setTab(nextTab);
  };

  const boardMatches = useMemo(() => uniqueFixtures([...live, ...upcoming, ...fixtures]), [live, upcoming, fixtures]);
  const pickById = useMemo(() => {
    const map = new Map<string, BetPickRow>();
    const remember = (key: string, p: BetPickRow) => {
      if (!key || map.has(key)) return;
      map.set(key, p);
    };
    const pools = [...(picks?.safest ?? []), ...(picks?.popularPicks ?? []), ...(picks?.otherPicks ?? [])];
    for (const p of pools) {
      remember(p.fixtureId, p);
      remember(matchKey(p.home, p.away, p.kickoffUtc), p);
      remember(betMatchKey(p.home, p.away, p.kickoffUtc), p);
    }
    return map;
  }, [picks]);
  const pickFor = useCallback(
    (f: { id: string; home: { name: string }; away: { name: string }; kickoffUtc: string }) => {
      const keys = [
        f.id,
        matchKey(f.home.name, f.away.name, f.kickoffUtc),
        betMatchKey(f.home.name, f.away.name, f.kickoffUtc),
      ];
      for (const key of keys) {
        const hit = pickById.get(key);
        if (hit) return hit;
      }
      return undefined;
    },
    [pickById],
  );

  const rows: ListRow[] = useMemo(() => {
    const dayMatches = (which: 'today' | 'tomorrow') => {
      const targetDate = footballDateKey(new Date(Date.now() + (which === 'today' ? 0 : 24 * 60 * 60 * 1000)));
      const listed = boardMatches
        .filter((f) => (which === 'today' && f.live) || footballDateKey(new Date(f.kickoffUtc)) === targetDate)
        .sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || a.kickoffUtc.localeCompare(b.kickoffUtc));
      if (which === 'today' && listed.length === 0) {
        const horizon = Date.now() + 36 * 60 * 60 * 1000;
        return boardMatches
          .filter((f) => f.live || Date.parse(f.kickoffUtc) <= horizon)
          .sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || a.kickoffUtc.localeCompare(b.kickoffUtc));
      }
      return listed;
    };
    const toMatchRow = (scoresFirst: boolean) => (f: BetFixture) => ({
      key: f.id,
      kind: 'match' as const,
      fixture: f,
      pick: pickFor(f),
      scoresFirst,
    });
    const scoreOfFixture = (f: BetFixture) => {
      const p = pickFor(f);
      return p?.analysisScore ?? p?.safetyScore ?? 0;
    };
    const scoreOfPick = (p: BetPickRow | BetBookingLeg) => p.analysisScore ?? p.safetyScore ?? 0;
    if (tab === 'TODAY') {
      const todayAll = todayFixtures.length
        ? todayFixtures
        : dayMatches('today');
      return groupByPopularAndLeague(todayAll, popular, toMatchRow(false), {
        hideDayHeaders: true,
        countryFirst: true,
      });
    }
    if (tab === 'TOMORROW') {
      return groupByPopularAndLeague(dayMatches('tomorrow'), popular, toMatchRow(false), {
        countryFirst: true,
      });
    }
    if (tab === 'MULTISCORE') {
      const ms = picks?.multiScore?.length ? picks.multiScore : (picks?.safest ?? []).filter((p) => p.multiScore);
      return groupByPopularAndLeague(ms, popular, (p, i) => ({
        key: `${p.fixtureId}-ms-${i}`,
        kind: 'pick' as const,
        pick: p,
      }), { scoreOf: scoreOfPick, scoreFirst: true, hideDayHeaders: true });
    }
    if (tab === 'LIVE') {
      const inPlay = live.filter((f) => f.live);
      return groupByPopularAndLeague(inPlay, popular, (f) => ({
        key: f.id,
        kind: 'fixture' as const,
        fixture: f,
      }), { hideDayHeaders: true, scoreFirst: true });
    }
    if (tab === 'FIXTURES') {
      return groupByPopularAndLeague(fixtures, popular, toMatchRow(false), {
        scoreOf: scoreOfFixture,
        scoreFirst: true,
      });
    }
    if (tab === 'BOOKING') {
      const daily = picks?.daily100?.legs ?? picks?.booking?.daily100?.legs ?? [];
      const source = daily.length ? daily : (picks?.booking?.legs ?? []);
      return groupByPopularAndLeague(source, false, (leg) => ({
        key: `${leg.fixtureId}-${leg.market}`,
        kind: 'leg' as const,
        leg,
      }), { scoreOf: scoreOfPick, scoreFirst: true, hideDayHeaders: true });
    }
    if (tab === 'AVOID') {
      return (picks?.avoid ?? []).map((a) => ({
        key: a.fixtureId,
        kind: 'avoid' as const,
        fixtureId: a.fixtureId,
        match: a.match,
        reasons: a.reasons,
        country: a.country,
        countryFlag: a.countryFlag,
        league: a.league,
        leagueHeading: a.leagueHeading,
      }));
    }
    if (tab === 'ACCA') {
      const acc = picks?.accumulators ?? picks?.booking?.accumulators;
      if (!acc) return [];
      return [
        { key: 'safe', kind: 'acca' as const, title: 'Safe (80+)', row: acc.safe },
        { key: 'bal', kind: 'acca' as const, title: 'Balanced (75+)', row: acc.balanced },
        { key: 'high', kind: 'acca' as const, title: 'High odds (70+)', row: acc.highOdds },
      ];
    }
    const safestPool = picks?.safest?.length
      ? picks.safest
      : [...(picks?.popularPicks ?? []), ...(picks?.otherPicks ?? [])];
    if (tab === 'SAFEST') {
      const todayTmr = safestPool.filter(
        (p) => isOnCalendarDay(p.kickoffUtc, 'today') || isOnCalendarDay(p.kickoffUtc, 'tomorrow'),
      );
      return groupByPopularAndLeague(todayTmr.length ? todayTmr : safestPool, false, (p, i) => ({
        key: `${p.fixtureId}-${p.market}-${i}`,
        kind: 'pick' as const,
        pick: p,
      }), { scoreOf: scoreOfPick, scoreFirst: true });
    }
    const pool =
      tab === 'VALUE'
          ? picks?.bestValue?.length
            ? picks.bestValue
            : safestPool
          : tab === 'HIGH'
            ? picks?.highOdds?.length
              ? picks.highOdds
              : safestPool
            : picks?.elite?.length
              ? picks.elite
              : safestPool.slice(0, 16);
    return groupByPopularAndLeague(pool, false, (p, i) => ({
      key: `${p.fixtureId}-${p.market}-${i}`,
      kind: 'pick' as const,
      pick: p,
    }), { scoreOf: scoreOfPick, scoreFirst: true, hideDayHeaders: true });
  }, [tab, live, upcoming, fixtures, todayFixtures, picks, popular, boardMatches, pickFor]);

  const emptyCopy = () => {
    if (loading || picksLoading) return 'Loading…';
    if (tab === 'LIVE') return 'No live matches right now. Pull to refresh.';
    if (tab === 'TODAY') return 'No matches on the board yet. Pull to refresh — feeds can lag around midnight.';
    if (tab === 'TOMORROW') return 'No matches scheduled for tomorrow. Pull to refresh.';
    if (tab === 'MULTISCORE') return 'Waiting on multi-score combos (2-0, 2-1, 3-0, 3-1 or 0-2, 1-2, 0-3, 1-3). Pull to refresh.';
    if (tab === 'HIGH') return 'Waiting on high-odds markets from match stats. Pull to refresh.';
    if (tab === 'VALUE') return 'Waiting on value picks. Pull to refresh after fixtures load.';
    if (tab === 'ELITE') return 'Waiting on top-scoring picks. Pull to refresh after fixtures load.';
    if (tab === 'FIXTURES') return 'No fixtures in this filter.';
    if (tab === 'BOOKING') return 'Waiting on today’s slip. Pull to refresh after fixtures load.';
    if (tab === 'AVOID') return 'No matches to skip on this sample. Pull to refresh.';
    if (tab === 'ACCA') return 'Waiting on accumulator legs. Pull to refresh.';
    if (tab === 'SAFEST') return 'No today/tomorrow safest picks in this filter. Pull to refresh after fixtures load.';
    return 'Waiting on picks. Pull to refresh after fixtures load.';
  };

  return (
    <View style={common.screen}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
        <Pressable
          style={[common.secondaryBtn, { flex: 1, paddingVertical: 6, paddingHorizontal: 10 }]}
          onPress={() => navigation.navigate('BetSlip')}
        >
          <Text style={[common.secondaryBtnText, { fontSize: 12 }]}>Slip ({slip.selections.length})</Text>
        </Pressable>
        <Pressable
          style={[common.secondaryBtn, { flex: 1, paddingVertical: 6, paddingHorizontal: 10 }]}
          onPress={() => navigation.navigate('BetVerify')}
        >
          <Text style={[common.secondaryBtnText, { fontSize: 12 }]}>Verify</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, marginBottom: 6 }}
        contentContainerStyle={{ gap: 6, alignItems: 'center' }}
      >
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => selectTab(t.key)}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={{
                height: 32,
                paddingHorizontal: 12,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 6,
                borderWidth: 1,
                borderColor: on ? colors.accent : colors.border,
                backgroundColor: on ? colors.accent + '33' : colors.surface,
              }}
            >
              <Text style={{ color: on ? colors.accent : colors.muted, fontWeight: '700', fontSize: 12 }}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        key={tab}
        extraData={[tab, picksLoading, pickById, focusTick]}
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 56, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
        refreshControl={
          <RefreshControl
            refreshing={userRefreshing}
            onRefresh={() => {
              setUserRefreshing(true);
              void load().finally(() => setUserRefreshing(false));
            }}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View>
            <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={showFilters ? 8 : 3}>
              Analysis only. Not Bet9ja/SportyBet. Each card shows only that match’s Safest pick. Tap a card to see the Safest pick and qualified betting options. Multiscore is only on the Multiscore tab.
              {disclaimer ? ` ${disclaimer}` : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <Pressable
                onPress={() => setShowFilters((v) => !v)}
                style={[common.secondaryBtn, { flex: 1 }]}
              >
                <Text style={common.secondaryBtnText}>{showFilters ? 'Hide filters' : 'Search & filters'}</Text>
              </Pressable>
              <Pressable style={[common.primaryBtn, { flex: 1 }]} onPress={() => void load()}>
                <Text style={common.primaryBtnText}>Refresh</Text>
              </Pressable>
            </View>
            {showFilters ? (
              <View>
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search team or league"
                  placeholderTextColor={colors.muted}
                  style={inputStyle}
                  onSubmitEditing={() => void load()}
                />
                <TextInput
                  value={league}
                  onChangeText={setLeague}
                  placeholder="League"
                  placeholderTextColor={colors.muted}
                  style={inputStyle}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    value={marketFilter}
                    onChangeText={setMarketFilter}
                    placeholder="Market e.g. OVER_1_5"
                    placeholderTextColor={colors.muted}
                    style={[inputStyle, { flex: 1 }]}
                  />
                  <TextInput
                    value={riskFilter}
                    onChangeText={setRiskFilter}
                    placeholder="Risk"
                    placeholderTextColor={colors.muted}
                    style={[inputStyle, { width: 90 }]}
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    value={minimumProbability}
                    onChangeText={setMinimumProbability}
                    placeholder="Min probability %"
                    placeholderTextColor={colors.muted}
                    keyboardType="numeric"
                    style={[inputStyle, { flex: 1 }]}
                  />
                  <TextInput
                    value={minimumConfidence}
                    onChangeText={setMinimumConfidence}
                    placeholder="Min confidence %"
                    placeholderTextColor={colors.muted}
                    keyboardType="numeric"
                    style={[inputStyle, { flex: 1 }]}
                  />
                </View>
                <Pressable
                  onPress={() => setPopular((p) => !p)}
                  style={[common.secondaryBtn, { marginBottom: 8 }]}
                >
                  <Text style={common.secondaryBtnText}>
                    Popular teams {popular ? 'ON' : 'OFF'} — filter only
                  </Text>
                </Pressable>
                <Pressable style={[common.primaryBtn, { marginBottom: 8 }]} onPress={() => void load()}>
                  <Text style={common.primaryBtnText}>Apply filters</Text>
                </Pressable>
              </View>
            ) : null}
            {error ? (
              <View style={common.card}>
                <StatusBadge label="BET BOT ERROR" tone="danger" />
                <Text style={common.cardBody}>{error}</Text>
              </View>
            ) : null}
            {note ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={3}>
                {note}
              </Text>
            ) : null}
            <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={2}>
              {source || '…'}
              {status ? ` · ${status}` : ''}
              {picksLoading ? ' · ranking picks…' : ''}
            </Text>
            {tab === 'TODAY' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={3}>
                {loading
                  ? 'Loading today’s matches from all countries…'
                  : `${todayFixtures.length || rows.filter((r) => r.kind === 'match').length} matches today across ${new Set(todayFixtures.map((f) => f.country).filter(Boolean)).size || 'many'} countries.`}{' '}
                England, Spain, Italy, Germany, France, Nigeria, Saudi, Japan, Brazil, USA, and more.
              </Text>
            ) : null}
            {tab === 'TOMORROW' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={3}>
                Tomorrow’s football matches, grouped by top countries and leagues. Each card has the kick-off date and that match’s analysis.
              </Text>
            ) : null}
            {tab === 'MULTISCORE' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={4}>
                Multiscore only lives on this tab: home 2-0, 2-1, 3-0, 3-1 or away 0-2, 1-2, 0-3, 1-3. Confirm the box on Bet9ja/SportyBet.
              </Text>
            ) : null}
            {tab === 'HIGH' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={3}>
                Longer-priced markets from each match’s stats (not the same safest pick). Confirm prices on the site.
              </Text>
            ) : null}
            {tab === 'LIVE' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={3}>
                {live.length
                  ? liveNote || 'Live scores only. JSON feeds — ads blocked. Scores refresh automatically.'
                  : liveNote || 'No live games right now. Pull to refresh.'}
              </Text>
            ) : null}
            {tab === 'FIXTURES' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={3}>
                All upcoming days. Every country, popular and other leagues, with the flag on each heading. Highest analysis scores sit at the top of each league.
              </Text>
            ) : null}
            {tab === 'BOOKING' ? (
              <View>
                <View style={common.card}>
                  <Text style={common.cardTitle}>Daily 100-odds slip</Text>
                  <Text style={common.metric}>
                    {picks?.daily100?.combinedAnalysedOdds ?? picks?.booking?.daily100?.combinedAnalysedOdds ?? '—'}
                  </Text>
                  <Text style={common.cardBody}>
                    Combined analysed odds (confirm on Bet9ja/SportyBet). High-delivery legs only. Not a guarantee.
                  </Text>
                  <Text style={[common.cardBody, { marginTop: 6 }]}>
                    {picks?.daily100?.note ?? picks?.booking?.daily100?.note ?? picks?.booking?.note}
                  </Text>
                </View>
                <BookmakerSlips
                  slips={picks?.daily100?.bookSlips ?? picks?.booking?.daily100?.bookSlips ?? picks?.booking?.bookSlips ?? []}
                  loading={picksLoading}
                />
                <Pressable
                  style={[common.primaryBtn, { marginBottom: 8 }]}
                  disabled={!(picks?.daily100?.legs.length || picks?.booking?.daily100?.legs.length)}
                  onPress={fillDaily100}
                >
                  <Text style={common.primaryBtnText}>Save 100-odds slip</Text>
                </Pressable>
                <Pressable
                  style={[common.secondaryBtn, { marginBottom: 8 }]}
                  disabled={!picks?.booking?.legs.length}
                  onPress={fillBookingSlip}
                >
                  <Text style={common.secondaryBtnText}>Save short safe slip</Text>
                </Pressable>
              </View>
            ) : null}
            {tab === 'ACCA' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]}>
                Accumulators use the strongest available legs. Confirm prices on Bet9ja/SportyBet.
              </Text>
            ) : null}
            {tab === 'AVOID' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={3}>
                Matches to skip: safety below 70%, rejected markets, or conflicting stats. Reasons are on the card.
              </Text>
            ) : null}
            {tab === 'SAFEST' || tab === 'VALUE' || tab === 'ELITE' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={4}>
                {tab === 'SAFEST'
                  ? 'Today and tomorrow, highest safety % first in each league. The Safest line on the card is the same pick you see when you open the match.'
                  : picks?.note ?? 'One pick per match with the safety % on the card. Popular and other leagues from every country, with flags.'}
              </Text>
            ) : null}
            {loading && rows.length === 0 ? <ActivityIndicator color={colors.accent} /> : null}
          </View>
        }
        ListEmptyComponent={
          loading || picksLoading ? null : <Text style={[common.cardBody, { marginTop: 8 }]}>{emptyCopy()}</Text>
        }
        renderItem={({ item }) => {
          if (item.kind === 'section') {
            return (
              <View style={{ paddingTop: 12, paddingBottom: 6 }}>
                <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 13 }}>{item.title}</Text>
              </View>
            );
          }
          if (item.kind === 'fixture') {
            const f = item.fixture;
            return (
              <Pressable
                style={betCardStyle}
                onPress={() => navigation.navigate('BetFixture', { id: f.id })}
              >
                <CountryLeagueLine
                  leagueHeading={f.leagueHeading}
                  countryFlag={f.countryFlag}
                  country={f.country}
                  league={f.league}
                />
                {f.live ? (
                  <LiveScoreboard
                    home={f.home.name}
                    away={f.away.name}
                    score={f.score}
                    minute={f.minute}
                  />
                ) : (
                  <SplitTeams home={f.home.name} away={f.away.name} />
                )}
              </Pressable>
            );
          }
          if (item.kind === 'match') {
            const mk = betMatchKey(item.fixture.home.name, item.fixture.away.name, item.fixture.kickoffUtc);
            const cached = lookupBetCardAnalysis(item.fixture.id, mk);
            return (
              <BoardMatchCard
                fixture={item.fixture}
                pick={item.pick}
                scoresFirst={item.scoresFirst}
                analysing={picksLoading && !item.pick && !cached}
                onPress={() => navigation.navigate('BetFixture', { id: item.pick?.fixtureId || item.fixture.id })}
              />
            );
          }
          if (item.kind === 'leg') {
            const leg = item.leg;
            const score = leg.analysisScore ?? leg.safetyScore;
            const teams = splitMatch(leg.match, leg.home, leg.away);
            return (
              <Pressable
                style={betCardStyle}
                onPress={() => navigation.navigate('BetFixture', { id: leg.fixtureId })}
              >
                <CountryLeagueLine
                  leagueHeading={leg.leagueHeading}
                  countryFlag={leg.countryFlag}
                  country={leg.country}
                  league={leg.league}
                />
                <SplitTeams home={teams.home} away={teams.away} />
                <View style={{ height: 8 }} />
                <MarketLines
                  lines={leg.cardLines}
                  score={score}
                  stake={leg.label}
                  safestOnly
                />
              </Pressable>
            );
          }
          if (item.kind === 'pick') {
            return (
              <PickCard
                item={item.pick}
                showMultiscore={tab === 'MULTISCORE'}
                onPress={() => navigation.navigate('BetFixture', { id: item.pick.fixtureId })}
              />
            );
          }
          if (item.kind === 'avoid') {
            return (
              <Pressable
                style={betCardStyle}
                onPress={() => navigation.navigate('BetFixture', { id: item.fixtureId })}
              >
                <CountryLeagueLine
                  leagueHeading={item.leagueHeading}
                  countryFlag={item.countryFlag}
                  country={item.country}
                  league={item.league}
                />
                <SplitTeams {...splitMatch(item.match)} />
                <View style={{ height: 8 }} />
                <StatusBadge label="AVOID" tone="danger" />
                <Text style={[common.cardBody, { marginTop: 12 }]}>{item.reasons.join(' · ')}</Text>
              </Pressable>
            );
          }
          return (
            <View style={betCardStyle}>
              <Text style={[common.cardTitle, { marginBottom: 8 }]}>{item.title}</Text>
              <Text style={[common.cardBody, { marginBottom: 8 }]}>{item.row.note}</Text>
              {item.row.legs.map((leg) => {
                const teams = splitMatch(leg.match, leg.home, leg.away);
                return (
                  <Pressable
                    key={`${leg.fixtureId}-${leg.market}`}
                    onPress={() => navigation.navigate('BetFixture', { id: leg.fixtureId })}
                    style={[betCardStyle, { marginTop: 8, marginBottom: 12 }]}
                  >
                    <CountryLeagueLine
                      leagueHeading={leg.leagueHeading}
                      countryFlag={leg.countryFlag}
                      country={leg.country}
                      league={leg.league}
                    />
                    <SplitTeams home={teams.home} away={teams.away} />
                    <View style={{ height: 8 }} />
                    <MarketLines
                      lines={leg.cardLines}
                      score={leg.analysisScore ?? leg.safetyScore}
                      stake={leg.label}
                    />
                  </Pressable>
                );
              })}
            </View>
          );
        }}
      />
    </View>
  );
}

const inputStyle = {
  color: colors.text,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 10,
  padding: 10,
  marginBottom: 8,
};

function PickCard({
  item,
  showMultiscore,
  onPress,
}: {
  item: BetPickRow;
  showMultiscore?: boolean;
  onPress: () => void;
}) {
  const score = item.analysisScore ?? item.safetyScore;
  const teams = splitMatch(item.match, item.home, item.away);
  return (
    <Pressable style={betCardStyle} onPress={onPress}>
      <CountryLeagueLine
        leagueHeading={item.leagueHeading}
        countryFlag={item.countryFlag}
        country={item.country}
        league={item.league}
      />
      <SplitTeams home={teams.home} away={teams.away} />
      <KickoffDate iso={item.kickoffUtc} />
      <View style={{ height: 8 }} />
      <MarketLines
        lines={item.cardLines}
        score={score}
        stake={item.label}
        showMultiscore={showMultiscore}
        multiScore={showMultiscore ? item.multiScore : undefined}
        safestOnly={!showMultiscore}
      />
    </Pressable>
  );
}

function uniqueFixtures(items: BetFixture[]): BetFixture[] {
  const map = new Map<string, BetFixture>();
  for (const f of items) {
    const key = matchKey(f.home.name, f.away.name, f.kickoffUtc) || f.id;
    const prev = map.get(key);
    if (!prev || (f.live && !prev.live)) map.set(key, f);
  }
  return [...map.values()];
}

function BoardMatchCard({
  fixture,
  pick,
  analysing,
  onPress,
}: {
  fixture: BetFixture;
  pick?: BetPickRow;
  scoresFirst?: boolean;
  analysing?: boolean;
  onPress: () => void;
}) {
  const mk = betMatchKey(fixture.home.name, fixture.away.name, fixture.kickoffUtc);
  const cached = lookupBetCardAnalysis(fixture.id, mk);
  const score = pick?.analysisScore ?? pick?.safetyScore ?? cached?.score;
  const lines = pick?.cardLines?.length ? pick.cardLines : cached?.cardLines;
  const stake = pick?.label ?? cached?.label;
  const hasAnalysis = Boolean(lines?.length || score != null || stake);
  return (
    <Pressable style={betCardStyle} onPress={onPress}>
      <CountryLeagueLine
        leagueHeading={fixture.leagueHeading}
        countryFlag={fixture.countryFlag}
        country={fixture.country}
        league={fixture.league}
      />
      {fixture.live ? (
        <LiveScoreboard
          home={fixture.home.name}
          away={fixture.away.name}
          score={fixture.score}
          minute={fixture.minute}
        />
      ) : (
        <SplitTeams home={fixture.home.name} away={fixture.away.name} />
      )}
      <KickoffDate iso={fixture.kickoffUtc} />
      <View style={{ height: 8 }} />
      {hasAnalysis ? (
        <MarketLines lines={lines} score={score} stake={stake} />
      ) : (
        <Text style={common.cardBody}>
          {analysing ? 'Fetching analysis…' : 'Tap for full analysis'}
        </Text>
      )}
    </Pressable>
  );
}

function countryLeague(item: {
  country?: string;
  countryFlag?: string;
  league?: string;
  leagueHeading?: string;
}): string {
  if (item.leagueHeading) return item.leagueHeading;
  const flag = item.countryFlag ? `${item.countryFlag} ` : '';
  if (item.country && item.league) return `${flag}${item.country} · ${item.league}`;
  return item.league || item.country || '';
}

const TOP_COUNTRY_ORDER = [
  'England',
  'Spain',
  'Italy',
  'Germany',
  'France',
  'Europe',
  'Netherlands',
  'Portugal',
  'Belgium',
  'Turkey',
  'Scotland',
  'Brazil',
  'Argentina',
  'USA',
  'Mexico',
  'Saudi Arabia',
  'Nigeria',
];

function topCountryRank(country?: string): number {
  const n = (country || '').trim().toLowerCase();
  const i = TOP_COUNTRY_ORDER.findIndex((c) => c.toLowerCase() === n);
  return i >= 0 ? i : 80;
}

function headingCountry(heading: string): string {
  const n = heading.toLowerCase();
  return TOP_COUNTRY_ORDER.find((c) => n.includes(c.toLowerCase())) || heading;
}

function groupCountryRank<T extends { country?: string }>(heading: string, items: T[]): number {
  const fromItem = items[0]?.country?.trim();
  return topCountryRank(fromItem || headingCountry(heading));
}

function groupByPopularAndLeague<
  T extends {
    popularMatch?: boolean;
    country?: string;
    countryFlag?: string;
    league?: string;
    leagueHeading?: string;
    kickoffUtc?: string;
    live?: boolean;
    topLeague?: boolean;
    analysisScore?: number;
    safetyScore?: number;
  },
>(
  items: T[],
  popularOnly: boolean,
  toRow: (item: T, i: number) => ListRow,
  opts?: {
    hideDayHeaders?: boolean;
    scoreOf?: (item: T) => number;
    scoreFirst?: boolean;
    countryFirst?: boolean;
  },
): ListRow[] {
  const scoreOf = (item: T) => opts?.scoreOf?.(item) ?? item.analysisScore ?? item.safetyScore ?? 0;
  if (opts?.scoreFirst || opts?.countryFirst) {
    const out: ListRow[] = [];
    const dayBuckets = new Map<string, T[]>();
    if (opts.hideDayHeaders) {
      dayBuckets.set('one', [...items]);
    } else {
      const ordered = [...items].sort((a, b) => compareKickoffDay(a.kickoffUtc, b.kickoffUtc));
      for (const item of ordered) {
        const key = localDayKey(item.kickoffUtc);
        const arr = dayBuckets.get(key) ?? [];
        arr.push(item);
        dayBuckets.set(key, arr);
      }
    }
    for (const [dayKey, dayItems] of dayBuckets) {
      if (!opts.hideDayHeaders) {
        out.push({ key: `day-${dayKey}`, kind: 'section', title: dayTitle(dayKey) });
      }
      const list = popularOnly ? dayItems.filter((x) => x.popularMatch) : dayItems;
      const buckets = new Map<string, T[]>();
      for (const item of list) {
        const heading = countryLeague(item) || 'League';
        const arr = buckets.get(heading) ?? [];
        arr.push(item);
        buckets.set(heading, arr);
      }
      const headings = [...buckets.keys()].sort((a, b) => {
        if (opts.countryFirst) {
          const ra = groupCountryRank(a, buckets.get(a) ?? []);
          const rb = groupCountryRank(b, buckets.get(b) ?? []);
          return ra - rb || a.localeCompare(b);
        }
        const maxA = Math.max(0, ...(buckets.get(a) ?? []).map(scoreOf));
        const maxB = Math.max(0, ...(buckets.get(b) ?? []).map(scoreOf));
        return maxB - maxA || a.localeCompare(b);
      });
      for (const heading of headings) {
        const group = (buckets.get(heading) ?? []).sort((a, b) =>
          opts.countryFirst
            ? (a.kickoffUtc || '').localeCompare(b.kickoffUtc || '')
            : scoreOf(b) - scoreOf(a) || (a.kickoffUtc || '').localeCompare(b.kickoffUtc || ''),
        );
        out.push({ key: `lg-score-${dayKey}-${heading}`, kind: 'section', title: heading });
        group.forEach((item, i) => out.push(toRow(item, i)));
      }
    }
    return out;
  }
  const sorted = [...items].sort((a, b) => {
    const day = compareKickoffDay(a.kickoffUtc, b.kickoffUtc);
    if (day) return day;
    if (Boolean(a.live) !== Boolean(b.live)) return a.live ? -1 : 1;
    if (Boolean(a.popularMatch) !== Boolean(b.popularMatch)) {
      return Number(Boolean(b.popularMatch)) - Number(Boolean(a.popularMatch));
    }
    return (a.kickoffUtc || '').localeCompare(b.kickoffUtc || '');
  });
  const out: ListRow[] = [];
  const dayBuckets = new Map<string, T[]>();
  if (opts?.hideDayHeaders) {
    dayBuckets.set('one', sorted);
  } else {
    for (const item of sorted) {
      const key = localDayKey(item.kickoffUtc);
      const arr = dayBuckets.get(key) ?? [];
      arr.push(item);
      dayBuckets.set(key, arr);
    }
  }
  for (const [dayKey, dayItems] of dayBuckets) {
    if (!opts?.hideDayHeaders) {
      out.push({ key: `day-${dayKey}`, kind: 'section', title: dayTitle(dayKey) });
    }
    const popularItems = dayItems.filter((x) => x.popularMatch);
    const otherItems = dayItems.filter((x) => !x.popularMatch);
    const addBanner = (banner: string, list: T[]) => {
      if (!list.length) return;
      out.push({ key: `sec-${dayKey}-${banner}`, kind: 'section', title: banner });
      const buckets = new Map<string, T[]>();
      for (const item of list) {
        const heading = countryLeague(item) || 'League';
        const arr = buckets.get(heading) ?? [];
        arr.push(item);
        buckets.set(heading, arr);
      }
      const headings = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
      for (const heading of headings) {
        const group = (buckets.get(heading) ?? []).sort(
          (a, b) => scoreOf(b) - scoreOf(a) || (a.kickoffUtc || '').localeCompare(b.kickoffUtc || ''),
        );
        out.push({ key: `lg-${dayKey}-${banner}-${heading}`, kind: 'section', title: heading });
        group.forEach((item, i) => out.push(toRow(item, i)));
      }
    };
    addBanner('Popular', popularItems);
    if (!popularOnly) addBanner('Other leagues', otherItems);
  }
  return out;
}

function localDayKey(iso?: string | Date): string {
  const d = iso instanceof Date ? iso : iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '9999-12-31';
  return footballDateKey(d);
}

function utcDayKey(iso?: string | Date): string {
  const d = iso instanceof Date ? iso : iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '9999-12-31';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isOnCalendarDay(iso?: string, which: 'today' | 'tomorrow' = 'today'): boolean {
  const target = new Date();
  if (which === 'tomorrow') target.setDate(target.getDate() + 1);
  if (!iso) return which === 'today';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return which === 'today';
  return localDayKey(d) === localDayKey(target) || utcDayKey(d) === utcDayKey(target);
}

function matchKey(home?: string, away?: string, kickoffUtc?: string): string {
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${fold(home || '')}|${fold(away || '')}|${(kickoffUtc || '').slice(0, 10)}`;
}

function tomorrowKey(): string {
  const tmr = new Date();
  tmr.setDate(tmr.getDate() + 1);
  return localDayKey(tmr);
}

function compareKickoffDay(a?: string, b?: string): number {
  const today = localDayKey();
  const tmr = tomorrowKey();
  const rank = (iso?: string) => {
    const k = localDayKey(iso);
    if (k === today) return 0;
    if (k === tmr) return 1;
    return 2;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  const da = localDayKey(a);
  const db = localDayKey(b);
  if (da !== db) return da.localeCompare(db);
  return (a || '').localeCompare(b || '');
}

function dayTitle(key: string): string {
  const pretty = formatDayLabel(key);
  if (key === localDayKey()) return `Today · ${pretty}`;
  if (key === tomorrowKey()) return `Tomorrow · ${pretty}`;
  return pretty;
}

function formatDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y || 2026, (m || 1) - 1, d || 1);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
