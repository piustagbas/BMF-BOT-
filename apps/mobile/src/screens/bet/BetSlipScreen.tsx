import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchBetPicks, quoteBetSlip, type BetBookmaker, type BetBookmakerSlip } from '../../api/client';
import { useBetSlip } from '../../bet/BetSlipContext';
import { StatusBadge } from '../../components/StatusBadge';
import { colors, common, spacing } from '../../theme';
import type { BetBotStackParamList } from '../../navigation/types';
import { BookmakerSlips } from './BookmakerSlips';

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
          safetyScore: leg.safetyScore,
          riskLevel: leg.riskLevel,
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

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={{ paddingBottom: 48, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={common.title}>Bet slip</Text>
      <Text style={common.subtitle}>
        Choose a bookmaker. Booking codes are never invented — if the book has no official API, enter the
        slip manually. Booking fills different top-league matches by delivery rate, not every fixture.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
        {BOOKS.map((b) => {
          const on = slip.bookmaker === b.id;
          return (
            <Pressable
              key={b.id}
              onPress={() => slip.setBookmaker(b.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
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
        style={[common.secondaryBtn, { marginBottom: spacing.sm }]}
        disabled={filling}
        onPress={() => void fillFromDelivery()}
      >
        <Text style={common.secondaryBtnText}>
          {filling ? 'Filling from best delivery…' : 'Fill from best delivery (mixed leagues)'}
        </Text>
      </Pressable>
      {fillNote ? <Text style={[common.cardBody, { marginBottom: 8 }]}>{fillNote}</Text> : null}
      <BookmakerSlips slips={bookSlips} />
      {slip.selections.map((s) => (
        <View key={`${s.fixtureId}-${s.market}`} style={common.card}>
          <Text style={common.cardTitle}>
            {s.home} vs {s.away}
          </Text>
          <Text style={common.cardBody}>
            {s.label} · {s.odds ?? 'odds n/a'} · safety {s.safetyScore} · {s.riskLevel}
          </Text>
          <Pressable onPress={() => slip.remove(s.fixtureId, s.market)}>
            <Text style={{ color: colors.danger, marginTop: 6, fontWeight: '700' }}>Remove</Text>
          </Pressable>
        </View>
      ))}
      {slip.selections.length === 0 ? (
        <Text style={common.cardBody}>No selections. Fill from best delivery or open a fixture.</Text>
      ) : (
        <Pressable style={common.primaryBtn} disabled={busy} onPress={() => void build()}>
          <Text style={common.primaryBtnText}>{busy ? 'Building…' : 'Build slip'}</Text>
        </Pressable>
      )}
      {quoted ? (
        <View style={[common.card, { marginTop: spacing.md }]}>
          <StatusBadge label={quoted.bookingStatus} tone="warn" />
          <Text style={common.cardBody}>Combined odds: {quoted.combinedOdds ?? 'n/a (missing prices)'}</Text>
          <Text style={common.cardBody}>Avg safety: {quoted.avgSafety}</Text>
          <Text style={common.cardBody}>Booking code: not issued</Text>
          <Text style={[common.cardBody, { marginTop: 8 }]}>{quoted.message}</Text>
          <Text style={[common.cardBody, { marginTop: 8 }]}>{quoted.disclaimer}</Text>
        </View>
      ) : null}
      {msg && !quoted ? (
        <Text style={[common.cardBody, { color: colors.warn, marginTop: 8 }]}>{msg}</Text>
      ) : null}
      <Pressable
        style={[common.secondaryBtn, { marginTop: spacing.md }]}
        onPress={() => navigation.navigate('BetVerify')}
      >
        <Text style={common.secondaryBtnText}>Verify a ticket</Text>
      </Pressable>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
