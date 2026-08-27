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
import { useBetSlip } from '../../bet/BetSlipContext';
import { StatusBadge } from '../../components/StatusBadge';
import { colors, common } from '../../theme';
import type { BetBotStackParamList } from '../../navigation/types';
import { BookmakerSlips } from './BookmakerSlips';

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

type ListRow =
  | { key: string; kind: 'section'; title: string }
  | { key: string; kind: 'fixture'; fixture: BetFixture }
  | { key: string; kind: 'match'; fixture: BetFixture; pick?: BetPickRow; scoresFirst?: boolean }
  | { key: string; kind: 'pick'; pick: BetPickRow }
  | { key: string; kind: 'leg'; leg: BetBookingLeg }
  | { key: string; kind: 'avoid'; fixtureId: string; match: string; reasons: string[] }
  | { key: string; kind: 'acca'; title: string; row: BetAccumulator };

export function BetBotHomeScreen({ navigation }: Props) {
  const slip = useBetSlip();
  const [tab, setTab] = useState<Tab>('TODAY');
  const [q, setQ] = useState('');
  const [league, setLeague] = useState('');
  const [date, setDate] = useState('');
  const [popular, setPopular] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [fixtures, setFixtures] = useState<BetFixture[]>([]);
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
        safetyScore: leg.safetyScore,
        riskLevel: leg.riskLevel,
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
        safetyScore: leg.safetyScore,
        riskLevel: leg.riskLevel,
      })),
    );
    navigation.navigate('BetSlip');
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, fx, board] = await Promise.all([
        fetchBetStatus().catch(() => null),
        fetchBetFixtures({
          q: q.trim() || undefined,
          league: league.trim() || undefined,
          date: date.trim() || undefined,
          popular,
        }),
        fetchBetLiveFixtures({
          q: q.trim() || undefined,
          league: league.trim() || undefined,
          popular,
        }).catch(() => null),
      ]);
      setStatus(
        [st?.footballData, st?.oddsApi, st?.ai, st?.bookingCodes].filter(Boolean).join(' · '),
      );
      setDisclaimer(fx.disclaimer);
      setSource(board?.source || fx.source);
      setNote(fx.warning || fx.note || '');
      setFixtures(fx.items);
      setLive(board?.live ?? []);
      setUpcoming(board?.upcoming ?? []);
      setLiveNote(board?.note ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fixtures');
    } finally {
      setLoading(false);
    }
    setPicksLoading(true);
    try {
      setPicks(await fetchBetPicks());
    } catch {
      setPicks(null);
    } finally {
      setPicksLoading(false);
    }
  }, [q, league, date, popular]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useFocusEffect(
    useCallback(() => {
      void loadRef.current();
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

  const boardMatches = useMemo(() => uniqueFixtures([...live, ...upcoming, ...fixtures]), [live, upcoming, fixtures]);
  const pickById = useMemo(() => {
    const map = new Map<string, BetPickRow>();
    for (const p of [...(picks?.safest ?? []), ...(picks?.highOdds ?? []), ...(picks?.bestValue ?? [])]) {
      if (!map.has(p.fixtureId)) map.set(p.fixtureId, p);
    }
    return map;
  }, [picks]);

  const rows: ListRow[] = useMemo(() => {
    const dayMatches = (which: 'today' | 'tomorrow') => {
      const key = which === 'today' ? localDayKey() : tomorrowKey();
      return boardMatches
        .filter((f) => (which === 'today' && f.live) || localDayKey(f.kickoffUtc) === key)
        .sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || a.kickoffUtc.localeCompare(b.kickoffUtc));
    };
    const toMatchRow = (scoresFirst: boolean) => (f: BetFixture) => ({
      key: f.id,
      kind: 'match' as const,
      fixture: f,
      pick: pickById.get(f.id),
      scoresFirst,
    });
    const scoreOfFixture = (f: BetFixture) => {
      const p = pickById.get(f.id);
      return p?.analysisScore ?? p?.safetyScore ?? 0;
    };
    const scoreOfPick = (p: BetPickRow | BetBookingLeg) => p.analysisScore ?? p.safetyScore ?? 0;
    if (tab === 'TODAY') {
      return groupByPopularAndLeague(dayMatches('today'), popular, toMatchRow(false), {
        hideDayHeaders: true,
        scoreOf: scoreOfFixture,
      });
    }
    if (tab === 'TOMORROW') {
      return groupByPopularAndLeague(dayMatches('tomorrow'), popular, toMatchRow(false), {
        hideDayHeaders: true,
        scoreOf: scoreOfFixture,
      });
    }
    if (tab === 'MULTISCORE') {
      return groupByPopularAndLeague(picks?.multiScore ?? [], popular, (p, i) => ({
        key: `${p.fixtureId}-ms-${i}`,
        kind: 'pick' as const,
        pick: p,
      }), { scoreOf: scoreOfPick });
    }
    if (tab === 'LIVE') {
      return groupByPopularAndLeague([...live, ...upcoming], popular, toMatchRow(false), {
        scoreOf: scoreOfFixture,
      });
    }
    if (tab === 'FIXTURES') {
      return groupByPopularAndLeague(fixtures, popular, toMatchRow(false), {
        scoreOf: scoreOfFixture,
      });
    }
    if (tab === 'BOOKING') {
      const daily = picks?.daily100?.legs ?? picks?.booking?.daily100?.legs ?? [];
      const source = daily.length ? daily : (picks?.booking?.legs ?? []);
      return groupByPopularAndLeague(source, false, (leg) => ({
        key: `${leg.fixtureId}-${leg.market}`,
        kind: 'leg' as const,
        leg,
      }), { scoreOf: scoreOfPick });
    }
    if (tab === 'AVOID') {
      return (picks?.avoid ?? []).map((a) => ({
        key: a.fixtureId,
        kind: 'avoid' as const,
        fixtureId: a.fixtureId,
        match: a.match,
        reasons: a.reasons,
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
    const pool =
      tab === 'SAFEST'
        ? [...(picks?.popularPicks ?? []), ...(picks?.otherPicks ?? [])].length
          ? [...(picks?.popularPicks ?? []), ...(picks?.otherPicks ?? [])]
          : picks?.safest ?? []
        : tab === 'VALUE'
          ? picks?.bestValue ?? []
          : tab === 'HIGH'
            ? picks?.highOdds ?? []
            : picks?.elite ?? [];
    return groupByPopularAndLeague(pool, tab === 'ELITE', (p, i) => ({
      key: `${p.fixtureId}-${p.market}-${i}`,
      kind: 'pick' as const,
      pick: p,
    }), { scoreOf: scoreOfPick });
  }, [tab, live, upcoming, fixtures, picks, popular, boardMatches, pickById]);

  const emptyCopy = () => {
    if (loading || picksLoading) return 'Loading…';
    if (tab === 'LIVE') return 'No live or upcoming matches in this filter. Pull to refresh.';
    if (tab === 'TODAY') return 'No matches today in this filter. Pull to refresh.';
    if (tab === 'TOMORROW') return 'No matches tomorrow in this filter. Pull to refresh.';
    if (tab === 'MULTISCORE') return 'Waiting on multi-score combos (2-0, 2-1, 3-0, 3-1 or 0-2, 1-2, 0-3, 1-3). Pull to refresh.';
    if (tab === 'HIGH') return 'Waiting on high-odds markets from match stats. Pull to refresh.';
    if (tab === 'FIXTURES') return 'No fixtures in this filter.';
    if (tab === 'BOOKING') return 'Waiting on today’s slip. Pull to refresh after fixtures load.';
    if (tab === 'AVOID') return 'No risk flags on the current sample.';
    if (tab === 'ACCA') return 'Waiting on accumulator legs. Pull to refresh.';
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
              onPress={() => setTab(t.key)}
              style={{
                height: 28,
                paddingHorizontal: 10,
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
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 48, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={loading || picksLoading}
            onRefresh={() => void load()}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View>
            <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={showFilters ? 8 : 3}>
              Analysis only. Not Bet9ja/SportyBet. Every match is listed by day — popular and other leagues from all countries, with the country flag. Highest analysis scores are on the cards and sit at the top of each group.
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
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <TextInput
                    value={league}
                    onChangeText={setLeague}
                    placeholder="League"
                    placeholderTextColor={colors.muted}
                    style={[inputStyle, { flex: 1, marginBottom: 0 }]}
                  />
                  <TextInput
                    value={date}
                    onChangeText={setDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.muted}
                    style={[inputStyle, { width: 120, marginBottom: 0 }]}
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
                Every match kicking off today, every country. The analysis score is on the card when ready — highest first.
              </Text>
            ) : null}
            {tab === 'TOMORROW' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={3}>
                Every match kicking off tomorrow, every country. Highest analysis scores sit at the top of each league.
              </Text>
            ) : null}
            {tab === 'MULTISCORE' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={4}>
                Multi-score is a correct-score combo: home 2-0, 2-1, 3-0, 3-1 or away 0-2, 1-2, 0-3, 1-3. One bundle per match from the stats. Confirm the box on Bet9ja/SportyBet.
              </Text>
            ) : null}
            {tab === 'HIGH' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={3}>
                Longer-priced markets from each match’s stats (not the same safest pick). Confirm prices on the site.
              </Text>
            ) : null}
            {tab === 'LIVE' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={3}>
                {liveNote || 'All live and upcoming matches from every country. Popular and other leagues, grouped by flag · country · league.'}
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
            {tab === 'SAFEST' || tab === 'VALUE' || tab === 'ELITE' ? (
              <Text style={[common.cardBody, { marginBottom: 8 }]} numberOfLines={4}>
                {picks?.note ?? 'One pick per match with the analysis score on the card. Popular and other leagues from every country, with flags.'}
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
              <View style={{ paddingTop: 12, paddingBottom: 4 }}>
                <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 13 }}>{item.title}</Text>
              </View>
            );
          }
          if (item.kind === 'fixture') {
            const f = item.fixture;
            return (
              <Pressable
                style={common.card}
                onPress={() => navigation.navigate('BetFixture', { id: f.id })}
              >
                <View style={common.row}>
                  <Text style={[common.cardTitle, { flex: 1, flexShrink: 1 }]} numberOfLines={2}>
                    {f.home.name} vs {f.away.name}
                  </Text>
                  {f.live ? (
                    <StatusBadge label="LIVE" tone="danger" />
                  ) : f.popularMatch ? (
                    <StatusBadge label="POPULAR" tone="info" />
                  ) : (
                    <StatusBadge label="OTHER" tone="warn" />
                  )}
                </View>
                <Text style={common.cardBody}>
                  {f.live
                    ? `${f.score?.home ?? '-'} - ${f.score?.away ?? '-'}${f.minute ? ` · ${f.minute}'` : ''}`
                    : new Date(f.kickoffUtc).toLocaleString()}
                </Text>
                <Text style={common.cardBody}>{countryLeague(f)}</Text>
              </Pressable>
            );
          }
          if (item.kind === 'match') {
            return (
              <BoardMatchCard
                fixture={item.fixture}
                pick={item.pick}
                scoresFirst={item.scoresFirst}
                onPress={() => navigation.navigate('BetFixture', { id: item.fixture.id })}
              />
            );
          }
          if (item.kind === 'leg') {
            const leg = item.leg;
            return (
              <Pressable
                style={common.card}
                onPress={() => navigation.navigate('BetFixture', { id: leg.fixtureId })}
              >
                <View style={common.row}>
                  <Text style={[common.cardTitle, { flex: 1, flexShrink: 1 }]} numberOfLines={2}>
                    {leg.match}
                  </Text>
                  <StatusBadge
                    label={`${leg.analysisScore ?? leg.safetyScore}/100`}
                    tone={(leg.analysisScore ?? leg.safetyScore) >= 80 ? 'ok' : 'info'}
                  />
                </View>
                <Text style={[common.metric, { fontSize: 22, marginTop: 4 }]}>
                  {leg.analysisScore ?? leg.safetyScore}
                </Text>
                <Text style={common.cardBody}>Analysis score / 100 · delivery {leg.deliveryRate}%</Text>
                <Text style={[common.cardBody, { color: colors.text, fontWeight: '700' }]}>
                  Pick: {leg.label} · analysed {leg.analysedOdds ?? leg.odds.bestOdds ?? 'n/a'}
                </Text>
                {leg.reason ? (
                  <Text style={common.cardBody} numberOfLines={4}>
                    Why: {leg.reason}
                  </Text>
                ) : null}
                <MatchPackBlock item={leg} />
              </Pressable>
            );
          }
          if (item.kind === 'pick') {
            return (
              <PickCard
                item={item.pick}
                onPress={() => navigation.navigate('BetFixture', { id: item.pick.fixtureId })}
              />
            );
          }
          if (item.kind === 'avoid') {
            return (
              <Pressable
                style={common.card}
                onPress={() => navigation.navigate('BetFixture', { id: item.fixtureId })}
              >
                <Text style={common.cardTitle} numberOfLines={2}>
                  {item.match}
                </Text>
                <Text style={common.cardBody}>{item.reasons.join(' · ')}</Text>
              </Pressable>
            );
          }
          return (
            <View style={common.card}>
              <Text style={common.cardTitle}>{item.title}</Text>
              <Text style={common.cardBody}>{item.row.note}</Text>
              {item.row.legs.map((leg) => (
                <Pressable
                  key={`${leg.fixtureId}-${leg.market}`}
                  onPress={() => navigation.navigate('BetFixture', { id: leg.fixtureId })}
                  style={{ marginTop: 8 }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {leg.match} — {leg.label}
                  </Text>
                  <MatchPackBlock item={leg} />
                </Pressable>
              ))}
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

function PickCard({ item, onPress }: { item: BetPickRow; onPress: () => void }) {
  const score = item.analysisScore ?? item.safetyScore;
  const delivery = item.sampleDeliveryRate ?? item.deliveryRate ?? item.modelProbability;
  return (
    <Pressable style={common.card} onPress={onPress}>
      <View style={common.row}>
        <Text style={[common.cardTitle, { flex: 1, flexShrink: 1 }]} numberOfLines={2}>
          {item.match}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          {score != null ? (
            <StatusBadge label={`${score}/100`} tone={score >= 80 ? 'ok' : score >= 70 ? 'info' : 'warn'} />
          ) : (
            <StatusBadge label={item.riskLevel} tone={item.category === 'SAFEST' ? 'ok' : 'warn'} />
          )}
        </View>
      </View>
      <Text style={[common.metric, { fontSize: 22, marginTop: 4 }]}>{score != null ? `${score}` : '—'}</Text>
      <Text style={common.cardBody}>Analysis score · {item.riskLevel}</Text>
      <Text style={common.cardBody}>{new Date(item.kickoffUtc).toLocaleString()}</Text>
      <Text style={[common.cardBody, { color: colors.text, fontWeight: '700' }]}>
        Pick: {item.label} · analysed {item.analysedOdds ?? item.odds.bestOdds ?? 'n/a'} · delivery {delivery}%
      </Text>
      {item.multiScore ? (
        <View style={{ marginTop: 4, marginBottom: 4 }}>
          <Text style={[common.cardBody, { color: colors.text, fontWeight: '800', fontSize: 16 }]}>
            {item.multiScore.scores.map((s) => s.line).join('  ·  ')}
          </Text>
          <Text style={common.cardBody}>
            {item.multiScore.side === 'HOME' ? 'Home' : 'Away'} win scores · combined {item.multiScore.combinedProbability}%
            {item.multiScore.analysedOdds != null ? ` · analysed ${item.multiScore.analysedOdds}` : ''}
          </Text>
        </View>
      ) : null}
      {item.reason ? (
        <Text style={common.cardBody} numberOfLines={4}>
          Why: {item.reason}
        </Text>
      ) : null}
      <MatchPackBlock item={item} />
      {item.mainRisk ? (
        <Text style={common.cardBody} numberOfLines={2}>
          Risk: {item.mainRisk}
        </Text>
      ) : null}
    </Pressable>
  );
}

function uniqueFixtures(items: BetFixture[]): BetFixture[] {
  const map = new Map<string, BetFixture>();
  for (const f of items) {
    const prev = map.get(f.id);
    if (!prev || (f.live && !prev.live)) map.set(f.id, f);
  }
  return [...map.values()];
}

function BoardMatchCard({
  fixture,
  pick,
  scoresFirst,
  onPress,
}: {
  fixture: BetFixture;
  pick?: BetPickRow;
  scoresFirst?: boolean;
  onPress: () => void;
}) {
  const score = pick?.analysisScore ?? pick?.safetyScore;
  const pack = {
    home: pick?.home || fixture.home.name,
    away: pick?.away || fixture.away.name,
    last5Home: pick?.last5Home,
    last5Away: pick?.last5Away,
    scoresHome: pick?.scoresHome,
    scoresAway: pick?.scoresAway,
    country: pick?.country || fixture.country,
    countryFlag: pick?.countryFlag || fixture.countryFlag,
    league: fixture.league,
    leagueHeading: pick?.leagueHeading || fixture.leagueHeading,
  };
  return (
    <Pressable style={common.card} onPress={onPress}>
      <View style={common.row}>
        <Text style={[common.cardTitle, { flex: 1, flexShrink: 1 }]} numberOfLines={2}>
          {fixture.home.name} vs {fixture.away.name}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          {fixture.live ? (
            <StatusBadge label="LIVE" tone="danger" />
          ) : fixture.popularMatch ? (
            <StatusBadge label="POPULAR" tone="info" />
          ) : (
            <StatusBadge label="OTHER" tone="warn" />
          )}
        </View>
      </View>
      {score != null ? (
        <>
          <Text style={[common.metric, { fontSize: 22, marginTop: 4 }]}>{score}</Text>
          <Text style={common.cardBody}>Analysis score / 100</Text>
        </>
      ) : (
        <Text style={common.cardBody}>Analysis loading…</Text>
      )}
      <Text style={common.cardBody}>
        {fixture.live
          ? `${fixture.score?.home ?? '-'} - ${fixture.score?.away ?? '-'}${fixture.minute ? ` · ${fixture.minute}'` : ''}`
          : new Date(fixture.kickoffUtc).toLocaleString()}
      </Text>
      {scoresFirst ? <MatchPackBlock item={pack} /> : null}
      {pick ? (
        <Text style={[common.cardBody, { color: colors.text, fontWeight: '700' }]}>
          Pick: {pick.label} · analysed {pick.analysedOdds ?? pick.odds.bestOdds ?? 'n/a'}
        </Text>
      ) : null}
      {!scoresFirst ? <MatchPackBlock item={pack} /> : null}
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

function groupByPopularAndLeague<
  T extends {
    popularMatch?: boolean;
    country?: string;
    countryFlag?: string;
    league?: string;
    leagueHeading?: string;
    kickoffUtc?: string;
    live?: boolean;
    analysisScore?: number;
    safetyScore?: number;
  },
>(
  items: T[],
  popularOnly: boolean,
  toRow: (item: T, i: number) => ListRow,
  opts?: { hideDayHeaders?: boolean; scoreOf?: (item: T) => number },
): ListRow[] {
  const scoreOf = (item: T) => opts?.scoreOf?.(item) ?? item.analysisScore ?? item.safetyScore ?? 0;
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function MatchPackBlock({
  item,
}: {
  item: {
    home?: string;
    away?: string;
    match?: string;
    last5Home?: string;
    last5Away?: string;
    scoresHome?: string;
    scoresAway?: string;
    country?: string;
    countryFlag?: string;
    league?: string;
    leagueHeading?: string;
  };
}) {
  const homeName = item.home || item.match?.split(' vs ')[0] || 'Home';
  const awayName = item.away || item.match?.split(' vs ')[1] || 'Away';
  return (
    <View>
      <Text style={common.cardBody}>{countryLeague(item)}</Text>
      <Text style={common.cardBody} numberOfLines={5}>
        {homeName} last 5 {item.last5Home || '—'}
        {item.scoresHome ? ` · ${item.scoresHome}` : ' · scores loading from feed'}
      </Text>
      <Text style={common.cardBody} numberOfLines={5}>
        {awayName} last 5 {item.last5Away || '—'}
        {item.scoresAway ? ` · ${item.scoresAway}` : ' · scores loading from feed'}
      </Text>
    </View>
  );
}
