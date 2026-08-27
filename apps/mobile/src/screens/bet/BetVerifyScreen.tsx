import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { verifyBetTicket, type BetBookmaker } from '../../api/client';
import { useBetSlip } from '../../bet/BetSlipContext';
import { StatusBadge } from '../../components/StatusBadge';
import { colors, common, spacing } from '../../theme';

export function BetVerifyScreen() {
  const slip = useBetSlip();
  const [code, setCode] = useState('');
  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof verifyBetTicket>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const lines = pasted
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [match, market, oddsRaw] = line.split('|').map((s) => s.trim());
          const odds = oddsRaw ? Number(oddsRaw) : undefined;
          return { match, market, odds: Number.isFinite(odds) ? odds : undefined };
        });
      setResult(
        await verifyBetTicket({
          bookmaker: slip.bookmaker as BetBookmaker,
          bookingCode: code.trim() || undefined,
          pastedSelections: lines.length ? lines : undefined,
          botSelections: slip.selections,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verify failed');
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
      <Text style={common.title}>Verify ticket</Text>
      <Text style={common.subtitle}>
        Official Bet9ja/SportyBet ticket lookup is not integrated. Paste a booking code (we will not fake a
        lookup) or paste lines: Match | Market | Odds
      </Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="Booking code (optional)"
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
        style={{
          color: colors.text,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          padding: 10,
          marginBottom: 8,
        }}
      />
      <TextInput
        value={pasted}
        onChangeText={setPasted}
        placeholder={'Arsenal vs Burnley | Over 1.5 goals | 1.55'}
        placeholderTextColor={colors.muted}
        multiline
        style={{
          color: colors.text,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          padding: 10,
          minHeight: 90,
          marginBottom: 8,
        }}
      />
      <Pressable style={common.primaryBtn} disabled={busy} onPress={() => void run()}>
        <Text style={common.primaryBtnText}>{busy ? 'Checking…' : 'Compare with bot slip'}</Text>
      </Pressable>
      {error ? (
        <Text style={[common.cardBody, { color: colors.danger, marginTop: 8 }]}>{error}</Text>
      ) : null}
      {result ? (
        <View style={[common.card, { marginTop: spacing.md }]}>
          <StatusBadge label={result.supported ? 'COMPARED' : 'NO BOOK API'} tone={result.supported ? 'ok' : 'warn'} />
          {result.message ? <Text style={common.cardBody}>{result.message}</Text> : null}
          <Text style={common.cardBody}>Matching: {result.matching.join('; ') || 'none'}</Text>
          <Text style={common.cardBody}>Missing: {result.missing.join('; ') || 'none'}</Text>
          <Text style={common.cardBody}>Changed: {result.changed.join('; ') || 'none'}</Text>
          <Text style={common.cardBody}>Odds changes: {result.oddsChanges.join('; ') || 'none'}</Text>
          <Text style={common.cardBody}>
            Total bot {result.totalOddsBot ?? 'n/a'} vs ticket {result.totalOddsTicket ?? 'n/a'}
          </Text>
          <Text style={[common.cardBody, { marginTop: 8 }]}>{result.disclaimer}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
