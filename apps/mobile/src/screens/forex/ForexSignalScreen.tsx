import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  executeForexSignal,
  fetchForexSignal,
  fetchForexStatus,
  recheckForexSignal,
  type FxSignal,
} from '../../api/client';
import { StatusBadge } from '../../components/StatusBadge';
import { colors, common, spacing } from '../../theme';
import type { ForexBotStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ForexBotStackParamList, 'ForexSignal'>;

export function ForexSignalScreen({ route, navigation }: Props) {
  const { id, side } = route.params;
  const [signal, setSignal] = useState<FxSignal | null>(null);
  const [killSwitch, setKillSwitch] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [ok, setOk] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, st] = await Promise.all([fetchForexSignal(id), fetchForexStatus()]);
      setSignal(s.signal);
      setKillSwitch(st.killSwitch);
      const check = await recheckForexSignal(id, side);
      setOk(check.ok);
      setBlockers(check.blockers);
      setNote(
        check.ok
          ? `Live recheck passed · still in zone · spread ${check.spreadPips ?? '—'} pips`
          : 'Live recheck failed — will not execute',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to recheck');
    } finally {
      setLoading(false);
    }
  }, [id, side]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await executeForexSignal(id, side);
      navigation.replace('ForexHome');
      void result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Execute blocked');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !signal) {
    return (
      <View style={[common.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      {signal ? (
        <>
          <Text style={common.title}>
            {signal.symbol} {side}
          </Text>
          <Text style={common.subtitle}>
            You clicked {side}. The bot rechecks live quotes, zone, spread, slippage, news, and session before any
            paper fill.
          </Text>
          <View style={[common.row, { marginBottom: spacing.sm }]}>
            <StatusBadge label={`QUALITY ${signal.setupQuality}/100`} tone="info" />
            <StatusBadge label={ok ? 'RECHECK PASS' : 'RECHECK FAIL'} tone={ok ? 'ok' : 'danger'} />
          </View>
          <View style={common.card}>
            <Text style={common.cardTitle}>Entry zone — not a single price</Text>
            <Text style={common.cardBody}>
              {signal.zone.low.toFixed(5)} – {signal.zone.high.toFixed(5)} · width {signal.zone.widthPips.toFixed(1)} pips
            </Text>
            <Text style={common.cardBody}>
              SL {signal.stopLoss} · TP1 {signal.takeProfit1} · TP2 {signal.takeProfit2} · {signal.suggestedLots} lots ·
              risk ${signal.riskUsd}
            </Text>
          </View>
          <View style={common.card}>
            <Text style={common.cardTitle}>Confidence is not probability</Text>
            <Text style={common.cardBody}>{signal.confidence.warning}</Text>
            <Text style={[common.cardBody, { marginTop: 6 }]}>{signal.confidence.sampleNote}</Text>
          </View>
          <View style={common.card}>
            <Text style={common.cardTitle}>Live recheck</Text>
            <Text style={common.cardBody}>{note}</Text>
            {killSwitch ? (
              <Text style={[common.cardBody, { color: colors.danger, marginTop: 6 }]}>
                Kill switch is ON. Disable it on the FX home screen before a paper fill.
              </Text>
            ) : null}
            {blockers.map((b) => (
              <Text key={b} style={[common.cardBody, { color: colors.warn, marginTop: 4 }]}>
                {b}
              </Text>
            ))}
            {signal.reasons.map((r) => (
              <Text key={r} style={[common.cardBody, { marginTop: 4 }]}>
                {r}
              </Text>
            ))}
          </View>
          <Pressable
            style={[common.primaryBtn, { opacity: ok && !killSwitch && !busy ? 1 : 0.45 }]}
            disabled={!ok || killSwitch || busy}
            onPress={() => void confirm()}
          >
            <Text style={common.primaryBtnText}>
              {busy ? 'Filling…' : `Confirm paper ${side}`}
            </Text>
          </Pressable>
        </>
      ) : null}
      {error ? (
        <View style={[common.card, { marginTop: spacing.md }]}>
          <StatusBadge label="BLOCKED" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
