import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchBetPicks, quoteBetSlip, type BetBookmaker, type BetBookmakerSlip } from '../../api/client';
import { useBetSlip } from '../../bet/BetSlipContext';
import { colors, common, spacing } from '../../theme';
import type { BetBotStackParamList } from '../../navigation/types';
import { MarketLines, SplitTeams, betCardStyle, splitMatch, CountryLeagueLine } from './BetCardLayout';

type Props = NativeStackScreenProps<BetBotStackParamList, 'BetSlip'>;

const BOOKS: Array<{ id: BetBookmaker; label: string }> = [
  { id: 'bet9ja', label: 'Bet9ja' },
  { id: 'sportybet', label: 'SportyBet' },
  { id: 'third', label: 'Third book' },
];

export function BetSlipScreen({ navigation }: Props) {
  const slip = useBetSlip();
  const [msg, setMsg] = useState<string | null>(null);
  const [quoted, setQuoted] = useState<Awaited<ReturnType<typeof quoteBetSlip>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [bookSlips, setBookSlips] = useState<BetBookmakerSlip[]>([]);
  const [hint, setHint] = useState<string | null>(null);

  const activeBook = useMemo(
    () => bookSlips.find((b) => b.id === slip.bookmaker) ?? bookSlips[0] ?? null,
    [bookSlips, slip.bookmaker],
  );

  const fillFromDelivery = async () => {
    setFilling(true);
    setFillNote(null);
    try {
      const pk = await fetchBetPicks();
      const legs = pk.booking?.legs ?? [];
      if (!legs.length) {
        setFillNote('No high-delivery mixed-league legs yet. Try again after fixtures load.');
        return;
      }
      slip.replaceAll(
        legs.map((leg) => ({
          fixtureId: leg.fixtureId,
          home: leg.home,
          away: leg.away,
          kickoffUtc: leg.kickoffUtc,
          market: leg.market,
          label: leg.label,
          odds: leg.odds.bestOdds,
          bookmaker: slip.bookmaker,
          safetyScore: leg.analysisScore ?? leg.safetyScore,
          riskLevel: leg.riskLevel,
          country: leg.country,
          countryFlag: leg.countryFlag,
          league: leg.league,
          leagueHeading: leg.leagueHeading,
          cardLines: leg.cardLines,
        })),
      );
      setQuoted(null);
      setFillNote(pk.booking.note);
      setBookSlips(pk.booking.bookSlips ?? []);
    } catch (e) {
      setFillNote(e instanceof Error ? e.message : 'Could not rank booking picks');
    } finally {
      setFilling(false);
    }
  };

  const build = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const q = await quoteBetSlip(slip.bookmaker, slip.selections);
      setQuoted(q);
      setMsg(q.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Slip failed');
    } finally {
      setBusy(false);
    }
  };

  const shareSlip = async () => {
    const text =
      activeBook?.copyText ||
      slip.selections
        .map((s, i) => `${i + 1}. ${s.home} vs ${s.away}\nSafe ${s.safetyScore}%\nStake: ${s.label}`)
        .join('\n\n');
    try {
      await Share.share({ message: text, title: 'Bet slip' });
      setHint('Slip ready to share.');
    } catch {
      setHint('Could not open share.');
    }
  };

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={{ paddingBottom: 56, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[common.title, { marginBottom: 16 }]}>Bet slip</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg }}>
        {BOOKS.map((b) => {
          const on = slip.bookmaker === b.id;
          return (
            <Pressable
              key={b.id}
              onPress={() => slip.setBookmaker(b.id)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: on ? colors.accent : colors.border,
              }}
            >
              <Text style={{ color: on ? colors.accent : colors.muted, fontWeight: '700' }}>{b.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        style={[common.secondaryBtn, { marginBottom: spacing.md }]}
        disabled={filling}
        onPress={() => void fillFromDelivery()}
      >
        <Text style={common.secondaryBtnText}>{filling ? 'Filling…' : 'Fill from best delivery'}</Text>
      </Pressable>
      {fillNote ? <Text style={[common.cardBody, { marginBottom: 16 }]}>{fillNote}</Text> : null}
      {hint ? <Text style={[common.cardBody, { color: colors.accent, marginBottom: 12 }]}>{hint}</Text> : null}

      {slip.selections.map((s, i) => (
        <View key={`${s.fixtureId}-${s.market}`} style={betCardStyle}>
          <Text style={[common.cardBody, { marginBottom: 8 }]}>{i + 1}.</Text>
          <CountryLeagueLine
            leagueHeading={s.leagueHeading}
            countryFlag={s.countryFlag}
            country={s.country}
            league={s.league}
          />
          <SplitTeams home={s.home} away={s.away} />
          <View style={{ height: 8 }} />
          <MarketLines lines={s.cardLines} score={s.safetyScore} stake={s.label} />
          <Pressable onPress={() => slip.remove(s.fixtureId, s.market)} style={{ marginTop: 10 }}>
            <Text style={{ color: colors.danger, fontWeight: '700' }}>Remove</Text>
          </Pressable>
        </View>
      ))}

      {slip.selections.length === 0 ? (
        <Text style={[common.cardBody, { marginTop: 8, lineHeight: 22 }]}>
          No selections. Fill from best delivery or open a fixture.
        </Text>
      ) : (
        <View style={{ gap: 12, marginTop: 4 }}>
          <Pressable style={common.primaryBtn} onPress={() => void shareSlip()}>
            <Text style={common.primaryBtnText}>Copy / share</Text>
          </Pressable>
          {activeBook?.site ? (
            <Pressable style={common.secondaryBtn} onPress={() => void Linking.openURL(activeBook.site!)}>
              <Text style={common.secondaryBtnText}>Open site</Text>
            </Pressable>
          ) : null}
          <Pressable style={common.secondaryBtn} disabled={busy} onPress={() => void build()}>
            <Text style={common.secondaryBtnText}>{busy ? 'Building…' : 'Build slip'}</Text>
          </Pressable>
        </View>
      )}
      {quoted ? (
        <View style={[betCardStyle, { marginTop: spacing.md }]}>
          <Text style={[common.metricLabel, { marginBottom: 8 }]}>Avg safe</Text>
          <Text style={[common.metric, { fontSize: 36 }]}>{quoted.avgSafety}%</Text>
          {quoted.message ? <Text style={[common.cardBody, { marginTop: 16 }]}>{quoted.message}</Text> : null}
        </View>
      ) : null}
      {msg && !quoted ? (
        <Text style={[common.cardBody, { color: colors.warn, marginTop: 8 }]}>{msg}</Text>
      ) : null}
      <Pressable
        style={[common.secondaryBtn, { marginTop: spacing.lg }]}
        onPress={() => navigation.navigate('BetVerify')}
      >
        <Text style={common.secondaryBtnText}>Verify a ticket</Text>
      </Pressable>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
