import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchBetFixture, type BetFixtureAnalysis, type BetMarketRow } from '../../api/client';
import { useBetSlip } from '../../bet/BetSlipContext';
import { StatusBadge } from '../../components/StatusBadge';
import { colors, common, spacing } from '../../theme';
import type { BetBotStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<BetBotStackParamList, 'BetFixture'>;

export function BetFixtureScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const slip = useBetSlip();
  const [data, setData] = useState<BetFixtureAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAvoid, setShowAvoid] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchBetFixture(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to analyze fixture');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const addMarket = (m: BetMarketRow) => {
    if (!data) return;
    slip.add({
      fixtureId: data.fixture.id,
      home: data.fixture.home.name,
      away: data.fixture.away.name,
      kickoffUtc: data.fixture.kickoffUtc,
      market: m.market,
      label: m.label,
      odds: m.odds.bestOdds ?? m.analysedOdds ?? null,
      bookmaker: slip.bookmaker,
      safetyScore: m.safetyScore,
      riskLevel: m.riskLevel,
    });
    navigation.navigate('BetSlip');
  };

  const qualified = useMemo(
    () => (data?.markets ?? []).filter((m) => m.category !== 'AVOID'),
    [data],
  );
  const avoided = useMemo(
    () => (data?.markets ?? []).filter((m) => m.category === 'AVOID'),
    [data],
  );
  const visibleMarkets = showAvoid ? [...qualified, ...avoided] : qualified;

  if (loading && !data) {
    return (
      <View style={[common.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={{ paddingBottom: 48, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      {error ? (
        <View style={common.card}>
          <StatusBadge label="ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}
      {data ? (
        <>
          <Text style={common.title} numberOfLines={2}>
            {data.fixture.home.name} vs {data.fixture.away.name}
          </Text>
          <Text style={common.subtitle}>
            {data.fixture.leagueHeading ||
              [data.fixture.countryFlag, data.fixture.country, data.fixture.league].filter(Boolean).join(' · ')}
            {data.fixture.venue ? ` · ${data.fixture.venue}` : ''}
            {' · '}
            {new Date(data.fixture.kickoffUtc).toLocaleString()}
          </Text>
          {data.fixture.live ? (
            <View style={common.card}>
              <StatusBadge label="LIVE" tone="danger" />
              <Text style={common.metric}>
                {data.fixture.score?.home ?? '-'} — {data.fixture.score?.away ?? '-'}
              </Text>
              <Text style={common.cardBody}>{data.fixture.minute ? `${data.fixture.minute}'` : 'In play'}</Text>
            </View>
          ) : null}

          {data.ai ? (
            <View style={common.card}>
              <View style={common.row}>
                <Text style={common.cardTitle}>Step 1 — Analyse both teams</Text>
                <StatusBadge label={data.ai.source === 'openai' ? 'CHATGPT' : 'AI READ'} tone="ok" />
              </View>
              <Text style={common.cardBody}>{data.ai.homeRead}</Text>
              <Text style={[common.cardBody, { marginTop: 6 }]}>{data.ai.awayRead}</Text>
              <Text style={[common.cardBody, { marginTop: 6 }]}>{data.ai.summary}</Text>
              {data.ai.lean ? (
                <Text style={[common.cardBody, { marginTop: 6 }]}>Lean: {data.ai.lean}</Text>
              ) : null}
              {data.ai.note ? (
                <Text style={[common.cardBody, { marginTop: 6 }]}>{data.ai.note}</Text>
              ) : null}
            </View>
          ) : null}

          {data.multiScore ? (
            <View style={common.card}>
              <Text style={common.cardTitle}>Multiscore</Text>
              <Text style={[common.cardTitle, { fontSize: 18 }]}>
                {data.multiScore.scores.map((s) => s.line).join('  ·  ')}
              </Text>
              <Text style={common.metric}>{data.multiScore.analysedOdds ?? '—'}</Text>
              <Text style={common.cardBody}>
                {data.multiScore.side === 'HOME' ? 'Home' : 'Away'} win combo · combined {data.multiScore.combinedProbability}%
              </Text>
              <Text style={[common.cardBody, { marginTop: 6 }]}>{data.multiScore.reason}</Text>
            </View>
          ) : null}

          {data.recommended ? (
            <View style={common.card}>
              <View style={common.row}>
                <Text style={common.cardTitle}>Step 2 — Bet to use</Text>
                <StatusBadge label={data.recommended.riskLevel} tone="ok" />
              </View>
              <Text style={common.metric}>
                {data.recommended.analysisScore ?? data.recommended.safetyScore}
              </Text>
              <Text style={common.cardBody}>Analysis score / 100</Text>
              <Text style={[common.cardTitle, { fontSize: 18 }]}>{data.recommended.label}</Text>
              <Text style={common.cardBody}>
                Analysed odds {data.recommended.analysedOdds ?? data.recommended.odds.bestOdds ?? '—'} (confirm on Bet9ja/SportyBet)
                {' · '}conf {data.recommended.confidence ?? data.recommended.safetyScore}%
                {data.recommended.sampleDeliveryRate != null
                  ? ` · delivery ${data.recommended.sampleDeliveryRate}%`
                  : ''}
              </Text>
              <Text style={[common.cardBody, { marginTop: 6 }]}>{data.recommended.reason}</Text>
              {data.recommended.whyQualified?.slice(0, 4).map((w) => (
                <Text key={w} style={common.cardBody}>
                  · {w}
                </Text>
              ))}
              {data.recommended.mainRisk ? (
                <Text style={[common.cardBody, { marginTop: 6 }]}>Main risk: {data.recommended.mainRisk}</Text>
              ) : null}
              {data.avoidReasons.length ? (
                <Text style={[common.cardBody, { marginTop: 6 }]}>
                  Watch-outs: {data.avoidReasons.join(' · ')}
                </Text>
              ) : null}
              <Pressable
                style={[common.primaryBtn, { marginTop: 10 }]}
                onPress={() => addMarket(data.recommended!)}
              >
                <Text style={common.primaryBtnText}>Add to slip</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={common.card}>
            <Text style={common.cardTitle} numberOfLines={1}>{data.fixture.home.name}</Text>
            <Text style={common.cardBody}>
              Last 5 {data.teamStats?.home.last5 && data.teamStats.home.last5 !== 'UNKNOWN' ? data.teamStats.home.last5 : data.form.home}
            </Text>
            <Text style={common.cardBody}>
              Last 10 {data.teamStats?.home.last10 && data.teamStats.home.last10 !== 'UNKNOWN' ? data.teamStats.home.last10 : data.form.last10Home}
            </Text>
            <Text style={common.cardBody}>
              {data.teamStats?.home.played ?? 0} played · {data.teamStats?.home.wins ?? 0}W {data.teamStats?.home.draws ?? 0}D {data.teamStats?.home.losses ?? 0}L
            </Text>
            <Text style={common.cardBody}>
              GF {data.teamStats?.home.gf ?? data.goals.homeFor} (avg {data.teamStats?.home.avgGf ?? '—'}) · GA {data.teamStats?.home.ga ?? data.goals.homeAgainst}
            </Text>
            {(data.teamStats?.home.recent ?? []).slice(0, 5).map((r) => (
              <Text key={`${r.opponent}-${r.playedAt ?? r.gf}`} style={common.cardBody}>
                {r.result} {r.isHome ? 'H' : 'A'} vs {r.opponent} {r.gf}-{r.ga}
              </Text>
            ))}
          </View>
          <View style={common.card}>
            <Text style={common.cardTitle} numberOfLines={1}>{data.fixture.away.name}</Text>
            <Text style={common.cardBody}>
              Last 5 {data.teamStats?.away.last5 && data.teamStats.away.last5 !== 'UNKNOWN' ? data.teamStats.away.last5 : data.form.away}
            </Text>
            <Text style={common.cardBody}>
              Last 10 {data.teamStats?.away.last10 && data.teamStats.away.last10 !== 'UNKNOWN' ? data.teamStats.away.last10 : data.form.last10Away}
            </Text>
            <Text style={common.cardBody}>
              {data.teamStats?.away.played ?? 0} played · {data.teamStats?.away.wins ?? 0}W {data.teamStats?.away.draws ?? 0}D {data.teamStats?.away.losses ?? 0}L
            </Text>
            <Text style={common.cardBody}>
              GF {data.teamStats?.away.gf ?? data.goals.awayFor} (avg {data.teamStats?.away.avgGf ?? '—'}) · GA {data.teamStats?.away.ga ?? data.goals.awayAgainst}
            </Text>
            {(data.teamStats?.away.recent ?? []).slice(0, 5).map((r) => (
              <Text key={`${r.opponent}-${r.playedAt ?? r.gf}`} style={common.cardBody}>
                {r.result} {r.isHome ? 'H' : 'A'} vs {r.opponent} {r.gf}-{r.ga}
              </Text>
            ))}
          </View>

          <View style={common.card}>
            <Text style={common.cardTitle}>Context</Text>
            <Text style={common.cardBody}>{data.homeAway}</Text>
            <Text style={common.cardBody}>{data.h2h}</Text>
            <Text style={common.cardBody}>{data.matchImportance}</Text>
            <Text style={common.cardBody}>{data.lineup.confirmed ? 'Starting XI confirmed.' : 'Starting XI not in the feed yet — not assumed.'}</Text>
            <Text style={common.cardBody}>{data.injuries.note}</Text>
            {data.sources?.length ? (
              <Text style={common.cardBody}>Sources: {data.sources.join(' · ')}</Text>
            ) : null}
          </View>

          {data.halfGoalPick ? (
            <View style={common.card}>
              <Text style={common.cardTitle}>Half-goal line</Text>
              <Text style={common.cardBody}>
                {data.halfGoalPick.label} — {data.halfGoalPick.reason}
              </Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, marginBottom: 8 }}>
            <Text style={common.cardTitle}>Markets ({qualified.length} qualified)</Text>
            {avoided.length ? (
              <Pressable onPress={() => setShowAvoid((v) => !v)}>
                <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>
                  {showAvoid ? 'Hide rejected' : `Show rejected (${avoided.length})`}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {visibleMarkets.map((m) => (
            <View key={m.market} style={common.card}>
              <View style={common.row}>
                <Text style={[common.cardTitle, { flex: 1, flexShrink: 1 }]} numberOfLines={2}>{m.label}</Text>
                <StatusBadge
                  label={m.category}
                  tone={m.category === 'AVOID' ? 'danger' : m.category === 'SAFEST' ? 'ok' : 'warn'}
                />
              </View>
              <Text style={common.cardBody}>
                Analysed {m.analysedOdds ?? 'n/a'}
                {m.odds.bestOdds != null ? ` · guide ${m.odds.bestOdds}` : ' · site price not invented'}
                {' · '}score {m.analysisScore ?? m.safetyScore}/100
                {m.sampleDeliveryRate != null ? ` · delivery ${m.sampleDeliveryRate}%` : ''}
              </Text>
              <Text style={[common.cardBody, { marginTop: 4 }]} numberOfLines={3}>{m.historicalNote}</Text>
              {m.mainRisk ? (
                <Text style={common.cardBody} numberOfLines={2}>
                  Main risk: {m.mainRisk}
                </Text>
              ) : null}
              {m.category !== 'AVOID' ? (
                <Pressable style={[common.secondaryBtn, { marginTop: 8 }]} onPress={() => addMarket(m)}>
                  <Text style={common.secondaryBtnText}>Add {m.label}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
