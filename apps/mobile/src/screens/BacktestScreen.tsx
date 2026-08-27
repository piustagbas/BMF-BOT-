import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchBacktests,
  runBacktest,
  trackSignalOutcome,
  type BacktestItem,
} from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common, spacing } from '../theme';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function fmt(n: number, d = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n === Infinity ? '∞' : n.toFixed(d);
}

export function BacktestScreen() {
  const [items, setItems] = useState<BacktestItem[]>([]);
  const [latest, setLatest] = useState<BacktestItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomeNote, setOutcomeNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchBacktests();
      setItems(res.items);
      setLatest(res.items[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load backtests');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await runBacktest({
        address: BONK,
        symbol: 'BONK',
        timeframe: '5m',
        startingBalance: 1000,
      });
      setLatest(result);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backtest failed');
    } finally {
      setLoading(false);
    }
  };

  const track = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await trackSignalOutcome(BONK);
      const o = res.outcome;
      setOutcomeNote(
        `${res.signalType}: TP1=${o.tp1Hit} TP2=${o.tp2Hit} SL=${o.slHit} MFE=${fmt(o.mfePct, 1)}% MAE=${fmt(o.maePct, 1)}% first=${o.firstExit}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Outcome tracking failed');
    } finally {
      setLoading(false);
    }
  };

  const oos = latest?.outOfSample;
  const full = latest?.full;

  return (
    <ScrollView
      style={common.screen}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={common.title}>Backtesting</Text>
      <Text style={common.subtitle}>
        In-sample vs out-of-sample. Prefer OOS. Past results do not guarantee future performance.
      </Text>

      {error ? (
        <View style={common.card}>
          <StatusBadge label="BACKTEST ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
        <Pressable
          onPress={() => void run()}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: colors.accent + '22',
            borderColor: colors.accent,
            borderWidth: 1,
          }}
        >
          <Text style={{ color: colors.accent }}>Run BONK 5m backtest</Text>
        </Pressable>
        <Pressable
          onPress={() => void track()}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
          }}
        >
          <Text style={{ color: colors.info }}>Track signal outcome</Text>
        </Pressable>
      </View>

      {loading && !latest ? <ActivityIndicator color={colors.accent} /> : null}

      {outcomeNote ? (
        <View style={common.card}>
          <StatusBadge label="SIGNAL OUTCOME" tone="info" />
          <Text style={common.cardBody}>{outcomeNote}</Text>
        </View>
      ) : null}

      {latest ? (
        <>
          <View style={common.card}>
            <StatusBadge label="OUT OF SAMPLE" tone="ok" />
            <Text style={common.cardTitle}>OOS performance (preferred)</Text>
            <Text style={common.cardBody}>
              Trades {oos?.performance.totalTrades ?? 0} · Win {fmt(oos?.performance.winRate ?? 0, 1)}% ·
              PF {fmt(oos?.performance.profitFactor ?? 0)} · Return {fmt(oos?.performance.totalPnlPct ?? 0)}%
            </Text>
            <Text style={common.cardBody}>
              Signals {oos?.signalsGenerated ?? 0} · Entries {oos?.entriesTaken ?? 0} · Max DD{' '}
              {fmt(oos?.performance.maxDrawdownPct ?? 0, 1)}%
            </Text>
          </View>

          <View style={common.card}>
            <StatusBadge label="FULL SAMPLE" tone="warn" />
            <Text style={common.cardTitle}>Full-sample (can overfit)</Text>
            <Text style={common.cardBody}>
              Trades {full?.performance.totalTrades ?? 0} · Win {fmt(full?.performance.winRate ?? 0, 1)}% ·
              Return {fmt(full?.performance.totalPnlPct ?? 0)}%
            </Text>
            <Text style={common.cardBody}>{latest.warning}</Text>
          </View>
        </>
      ) : (
        <Text style={common.cardBody}>No backtests yet. Run one to compare in-sample vs out-of-sample.</Text>
      )}

      <Text style={[common.cardTitle, { marginTop: spacing.md }]}>History ({items.length})</Text>
      {items.slice(0, 5).map((item) => (
        <View key={item.id} style={common.card}>
          <Text style={common.cardTitle}>{item.address.slice(0, 8)}…</Text>
          <Text style={common.cardBody}>
            OOS trades {item.outOfSample.performance.totalTrades} · Return{' '}
            {fmt(item.outOfSample.performance.totalPnlPct)}%
          </Text>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
