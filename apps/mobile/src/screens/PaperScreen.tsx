import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchPaperDashboard,
  openManualPaperTrade,
  paperTestEvent,
  resetPaperAccount,
  syncPaperPositions,
  type PaperDashboard,
} from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common, spacing } from '../theme';

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

export function PaperScreen() {
  const [data, setData] = useState<PaperDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPaperDashboard());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load paper dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const perf = data?.performance;
  const positions = data?.positions.items ?? [];

  return (
    <View style={common.screen}>
      <Text style={common.title}>Paper Trading</Text>
      <Text style={common.subtitle}>
        Simulated fills only — no chain transactions. Default balance $1,000. Not financial advice.
      </Text>

      {error ? (
        <View style={common.card}>
          <StatusBadge label="PAPER ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}

      {loading && !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <FlatList
          data={positions}
          keyExtractor={(p) => p.id}
          refreshControl={
            <RefreshControl refreshing={loading || busy} onRefresh={load} tintColor={colors.accent} />
          }
          ListHeaderComponent={
            <View>
              <View style={common.card}>
                <StatusBadge label="PAPER MODE" tone="ok" />
                <Text style={common.cardTitle}>Account</Text>
                <Text style={common.cardBody}>
                  Balance ${fmt(perf?.currentBalance ?? data?.account.balance ?? 0)} · Equity $
                  {fmt(perf?.equity ?? 0)}
                </Text>
                <Text style={common.cardBody}>
                  P/L ${fmt(perf?.totalPnl ?? 0)} ({fmt(perf?.totalPnlPct ?? 0)}%) · Win{' '}
                  {fmt(perf?.winRate ?? 0, 1)}%
                </Text>
                <Text style={common.cardBody}>
                  Trades {perf?.totalTrades ?? 0} · Open {perf?.openPositions ?? 0} · Max DD{' '}
                  {fmt(perf?.maxDrawdownPct ?? 0, 1)}%
                </Text>
                <Text style={common.cardBody}>
                  TP1 {fmt(perf?.tp1HitRate ?? 0, 0)}% · TP2 {fmt(perf?.tp2HitRate ?? 0, 0)}% · SL{' '}
                  {fmt(perf?.slRate ?? 0, 0)}%
                </Text>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    void run(() =>
                      openManualPaperTrade({
                        address: BONK,
                        symbol: 'BONK',
                        entryPrice: 0.00001,
                        stopLoss: 0.000009,
                        tp1Price: 0.000013,
                        tp2Price: 0.000016,
                      }),
                    )
                  }
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor: colors.accent + '22',
                    borderColor: colors.accent,
                    borderWidth: 1,
                  }}
                >
                  <Text style={{ color: colors.accent }}>Open test BONK</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => void run(() => syncPaperPositions())}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderWidth: 1,
                  }}
                >
                  <Text style={{ color: colors.info }}>Sync prices</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => void run(() => resetPaperAccount(1000))}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderWidth: 1,
                  }}
                >
                  <Text style={{ color: colors.warn }}>Reset $1000</Text>
                </Pressable>
              </View>

              <Text style={[common.cardTitle, { marginBottom: 8 }]}>Open positions</Text>
            </View>
          }
          ListEmptyComponent={
            <Text style={common.cardBody}>No open paper positions. Open a test trade to try TP/SL.</Text>
          }
          renderItem={({ item }) => (
            <View style={common.card}>
              <Text style={common.cardTitle}>
                ${item.symbol} · {item.status} · {item.remainingPct.toFixed(0)}% left
              </Text>
              <Text style={common.cardBody}>
                Entry {item.entryPrice} · SL {item.stopLoss}
              </Text>
              <Text style={common.cardBody}>
                TP1 {item.tp1Price} · TP2 {item.tp2Price}
              </Text>
              <Text style={common.cardBody}>
                Size ${fmt(item.sizeUsd)} · Realized ${fmt(item.realizedPnlUsd)}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {(['TP1', 'TP2', 'SL', 'TRAIL'] as const).map((event) => (
                  <Pressable
                    key={event}
                    disabled={busy}
                    onPress={() => void run(() => paperTestEvent(item.id, event))}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 6,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.bg,
                    }}
                  >
                    <Text style={{ color: colors.muted, fontSize: 12 }}>TEST {event}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          ListFooterComponent={
            <View style={{ marginTop: spacing.md, marginBottom: 40 }}>
              <Text style={[common.cardTitle, { marginBottom: 8 }]}>Closed trades</Text>
              {(data?.trades.items ?? []).slice(0, 8).map((t) => (
                <View key={t.id} style={common.card}>
                  <Text style={common.cardTitle}>
                    ${t.symbol} · {t.exitReason ?? 'CLOSED'}
                  </Text>
                  <Text style={common.cardBody}>
                    P/L ${fmt(t.realizedPnlUsd)} · Fees ${fmt(t.feesUsd)}
                  </Text>
                </View>
              ))}
            </View>
          }
        />
      )}
    </View>
  );
}
