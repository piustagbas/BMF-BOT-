import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchBetFixture, type BetFixtureAnalysis, type BetMarketRow } from '../../api/client';
import { lookupBetFixtureDetail, rememberBetFixtureAnalysis } from '../../bet/betAnalysisCache';
import { useBetSlip } from '../../bet/BetSlipContext';
import { StatusBadge } from '../../components/StatusBadge';
import { colors, common, spacing } from '../../theme';
import type { BetBotStackParamList } from '../../navigation/types';
import { LiveScoreboard } from './LiveScoreboard';
import { MarketLines } from './BetCardLayout';

type Props = NativeStackScreenProps<BetBotStackParamList, 'BetFixture'>;

export function BetFixtureScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const slip = useBetSlip();
  const [data, setData] = useState<BetFixtureAnalysis | null>(() => lookupBetFixtureDetail(id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !lookupBetFixtureDetail(id));
  const [aiLoading, setAiLoading] = useState(false);
  const [showAvoid, setShowAvoid] = useState(false);

  const load = useCallback(
    async (opts?: { background?: boolean }) => {
      const background = opts?.background === true;
      if (!background && !lookupBetFixtureDetail(id)) setLoading(true);
      setError(null);
      try {
        const fast = await fetchBetFixture(id, { llm: false });
        rememberBetFixtureAnalysis(fast);
        setData(fast);
        setLoading(false);
        if (!fast.ai?.source || fast.ai.source === 'local') {
          setAiLoading(true);
          try {
            const enriched = await fetchBetFixture(id, { llm: true });
            rememberBetFixtureAnalysis(enriched);
            setData(enriched);
          } catch {
            /* keep stats pick */
          } finally {
            setAiLoading(false);
          }
        }
      } catch (e) {
        setError((prev) => prev ?? (e instanceof Error ? e.message : 'Failed to analyze fixture'));
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const cached = lookupBetFixtureDetail(id);
    setData(cached ?? null);
    setError(null);
    setLoading(!cached);
    void load({ background: Boolean(cached) });
  }, [id, load]);

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
      country: data.fixture.country,
      countryFlag: data.fixture.countryFlag,
      league: data.fixture.league,
      leagueHeading: data.fixture.leagueHeading,
    });
    navigation.navigate('BetSlip');
  };

  const qualified = useMemo(() => {
    const recMarket = data?.recommended?.market;
    const ranked = data?.rankedMarkets ?? [];
    return (data?.markets ?? [])
      .filter((m) => m.category !== 'AVOID')
      .slice()
      .sort((a, b) => {
        if (recMarket && a.market === recMarket) return -1;
        if (recMarket && b.market === recMarket) return 1;
        const ra = ranked.indexOf(a.market);
        const rb = ranked.indexOf(b.market);
        const ia = ra >= 0 ? ra : 999;
        const ib = rb >= 0 ? rb : 999;
        return ia - ib || (b.analysisScore ?? b.safetyScore) - (a.analysisScore ?? a.safetyScore);
      });
  }, [data]);
  const avoided = useMemo(
    () =>
      (data?.markets ?? [])
        .filter((m) => m.category === 'AVOID')
        .slice()
        .sort((a, b) => (a.analysisScore ?? a.safetyScore) - (b.analysisScore ?? b.safetyScore)),
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
      refreshControl={<RefreshControl refreshing={loading && !data} onRefresh={() => void load()} tintColor={colors.accent} />}
    >
      {error ? (
        <View style={common.card}>
          <StatusBadge label="ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}
      {data ? (
        <>
          {data.fixture.live ? (
            <View style={[common.card, { marginBottom: spacing.md }]}>
              <LiveScoreboard
                home={data.fixture.home.name}
                away={data.fixture.away.name}
                score={data.fixture.score}
                minute={data.fixture.minute}
              />
            </View>
          ) : (
            <Text style={common.title} numberOfLines={2}>
              {data.fixture.home.name} vs {data.fixture.away.name}
            </Text>
          )}
          <Text style={common.subtitle}>
            {data.fixture.leagueHeading ||
              [data.fixture.countryFlag, data.fixture.country, data.fixture.league].filter(Boolean).join(' · ')}
            {data.fixture.venue ? ` · ${data.fixture.venue}` : ''}
            {data.fixture.live ? '' : ` · ${new Date(data.fixture.kickoffUtc).toLocaleString()}`}
          </Text>
          {aiLoading ? (
            <Text style={[common.cardBody, { color: colors.accent, marginBottom: 8 }]}>
              AI refining pick…
            </Text>
          ) : null}

          {data.recommended ? (
            <View style={common.card}>
              <View style={common.row}>
                <Text style={common.cardTitle}>Safest</Text>
                <StatusBadge
                  label={`${data.recommended.analysisScore ?? data.recommended.safetyScore}%`}
                  tone={(data.recommended.analysisScore ?? data.recommended.safetyScore) >= 80 ? 'ok' : (data.recommended.analysisScore ?? data.recommended.safetyScore) >= 70 ? 'info' : 'warn'}
                />
              </View>
              <Text style={[common.metric, { fontSize: 28 }]}>
                {data.recommended.analysisScore ?? data.recommended.safetyScore}%
              </Text>
              <Text style={common.cardBody}>Safety · {data.recommended.riskLevel}</Text>
              <Text style={[common.cardTitle, { fontSize: 18 }]}>
                {data.cardLines?.find((l) => l.family === 'Safest')?.detail || data.recommended.label}
              </Text>
              <View style={{ marginTop: 8, marginBottom: 6 }}>
                <MarketLines
                  lines={data.cardLines}
                  score={data.recommended.analysisScore ?? data.recommended.safetyScore}
                  stake={data.recommended.label}
                />
              </View>
              <Text style={common.cardBody}>
                Analysed odds {data.recommended.analysedOdds ?? data.recommended.odds.bestOdds ?? '—'} (confirm on Bet9ja/SportyBet)
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
          ) : (
            <View style={common.card}>
              <StatusBadge label="NO SAFE PICK" tone="danger" />
              <Text style={[common.cardBody, { marginTop: 6 }]}>
                {data.avoidReasons.join(' · ') || 'No market cleared 70% safety on this fixture.'}
              </Text>
            </View>
          )}

          {data.ai ? (
            <View style={common.card}>
              <View style={common.row}>
                <Text style={common.cardTitle}>Both teams + web-search AI vs stats</Text>
                <StatusBadge
                  label={data.ai.source === 'openai' ? 'CHATGPT' : 'FORM READ'}
                  tone="ok"
                />
              </View>
              <Text style={common.cardBody}>{data.ai.homeRead}</Text>
              <Text style={[common.cardBody, { marginTop: 6 }]}>{data.ai.awayRead}</Text>
              <Text style={[common.cardBody, { marginTop: 6 }]}>{data.ai.summary}</Text>
              {data.ai.statsMarket ? (
                <Text style={[common.cardBody, { marginTop: 6 }]}>
                  Stats pick {data.ai.statsMarket}
                  {data.ai.chosenFrom ? ` · kept ${data.ai.chosenFrom === 'openai' ? 'ChatGPT' : 'stats'} as the bet` : ''}
                </Text>
              ) : null}
              {data.ai.lean ? (
                <Text style={[common.cardBody, { marginTop: 6 }]}>Lean: {data.ai.lean}</Text>
              ) : null}
              {data.ai.note ? (
                <Text style={[common.cardBody, { marginTop: 6 }]}>{data.ai.note}</Text>
              ) : null}
              {data.ai.webSources?.length ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={common.cardBody}>Forecast sources searched:</Text>
                  {data.ai.webSources.slice(0, 3).map((source) => (
                    <Pressable
                      key={source.url}
                      onPress={() => void Linking.openURL(source.url).catch(() => undefined)}
                    >
                      <Text style={{ color: colors.accent, marginTop: 4 }} numberOfLines={2}>
                        {source.title || source.url}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {data.multiScore ? (
            <View style={common.card}>
              <Text style={common.cardTitle}>Multiscore</Text>
              <Text style={[common.cardBody, { marginBottom: 8 }]}>
                {data.multiScore.side === 'HOME' ? 'Home to win' : 'Away to win'}
              </Text>
              {data.multiScore.scores.map((s) => (
                <Text key={s.line} style={[common.cardTitle, { fontSize: 18, marginTop: 4 }]}>
                  {s.line}  {Math.round(s.probability)}%
                </Text>
              ))}
              <Text style={[common.metric, { marginTop: 10 }]}>{data.multiScore.analysedOdds ?? '—'}</Text>
              <Text style={common.cardBody}>
                Combined {data.multiScore.combinedProbability}%
              </Text>
              <Text style={[common.cardBody, { marginTop: 6 }]}>{data.multiScore.reason}</Text>
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
          {visibleMarkets.map((m) => {
            const score = m.analysisScore ?? m.safetyScore;
            const isSafest = data.recommended?.market === m.market;
            return (
            <View key={m.market} style={common.card}>
              <View style={common.row}>
                <Text style={[common.cardTitle, { flex: 1, flexShrink: 1 }]} numberOfLines={2}>{m.label}</Text>
                <StatusBadge
                  label={isSafest ? `SAFEST ${score}%` : `${score}%`}
                  tone={m.category === 'AVOID' ? 'danger' : isSafest ? 'ok' : score >= 80 ? 'ok' : score >= 70 ? 'info' : 'warn'}
                />
              </View>
              <Text style={common.cardBody}>
                Safety {score}% · {m.category === 'AVOID' ? 'Avoid' : m.riskLevel}
                {' · '}analysed {m.analysedOdds ?? 'n/a'}
                {m.odds.bestOdds != null ? ` · guide ${m.odds.bestOdds}` : ''}
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
            );
          })}
        </>
      ) : null}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
