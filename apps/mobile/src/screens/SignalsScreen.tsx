import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchSignals, type SignalItem } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { BuyWindowTimer } from '../components/BuyWindowTimer';
import { DexScreenerBuyButton } from '../components/DexScreenerBuyButton';
import { hardTestsPassed } from '../components/WhyNotBuyPanel';
import { TokenLogo } from '../components/TokenLogo';
import { CopyableAddress } from '../components/CopyableAddress';
import { formatPairAgeHours } from '@memecoinbot/shared';
import { buildTokenSourceTags } from '../utils/sourceTags';
import { colors, common, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { useMemecoinAutoTrade } from '../settings/MemecoinAutoTradeContext';

type FilterKey = 'BUY' | 'WATCH' | 'SETUP_FORMING' | 'NO_TRADE' | 'ALL';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'BUY', label: 'BUY' },
  { key: 'WATCH', label: 'WATCH' },
  { key: 'SETUP_FORMING', label: 'SETUP' },
  { key: 'NO_TRADE', label: 'NO TRADE' },
  { key: 'ALL', label: 'ALL' },
];

function toneForSignal(type: string): 'ok' | 'warn' | 'danger' | 'info' {
  if (type === 'BUY') return 'ok';
  if (type === 'NO_TRADE') return 'danger';
  if (type === 'SETUP_FORMING' || type === 'WATCH') return 'warn';
  return 'info';
}

export function SignalsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<SignalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState('recent');
  /** Show all returned signals by default; users can narrow to BUY/WATCH/etc. */
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const { addresses: autoTradeAddresses, toggle: toggleAutoTrade } =
    useMemecoinAutoTrade();

  const load = useCallback(async (scan = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSignals({ limit: scan ? 20 : 50, scan });
      setItems(res.items);
      setMode(res.mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load signals');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  const filtered = useMemo(() => {
    if (filter === 'ALL') return items;
    return items.filter((i) => i.signalType === filter);
  }, [items, filter]);

  return (
    <View style={common.screen}>
      <Text style={common.title}>Signals</Text>
      <Text style={common.subtitle}>
        Master rule: do not buy every coin. BUY only when independent signals agree and
        hard gates pass. Not financial advice.
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: active ? colors.accent : colors.border,
                backgroundColor: active ? colors.accent + '33' : colors.surface,
              }}
            >
              <Text
                style={{
                  color: active ? colors.accent : colors.muted,
                  fontWeight: '700',
                  fontSize: 12,
                }}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.sm }}>
        <Pressable
          onPress={() => void load(false)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ color: colors.info }}>Refresh recent</Text>
        </Pressable>
        <Pressable
          onPress={() => void load(true)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.accent,
            backgroundColor: colors.accent + '22',
          }}
        >
          <Text style={{ color: colors.accent }}>Scan live (slow)</Text>
        </Pressable>
      </View>

      <Text style={[common.cardBody, { marginBottom: spacing.sm }]}>
        Mode: {mode} · Showing {filtered.length}/{items.length} ({filter})
      </Text>

      {error ? (
        <View style={common.card}>
          <StatusBadge label="SIGNALS ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, idx) => `${item.token.address}-${item.generatedAt}-${idx}`}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => void load(false)} tintColor={colors.accent} />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            !loading ? (
              <Text style={common.cardBody}>
                {filter === 'BUY'
                  ? 'No BUY signals yet — gates are strict. Tap “Scan live”, or switch filter to WATCH / ALL.'
                  : `No ${filter} signals. Tap “Scan live” or pick another filter.`}
              </Text>
            ) : null
          }
          renderItem={({ item }) => {
            const testsPassed = item.whyNotBuy
              ? hardTestsPassed(item.whyNotBuy)
              : false;
            return (
            <View style={common.card}>
              <Pressable
                onPress={() =>
                  navigation.navigate('TokenDetails', {
                    address: item.token.address,
                  })
                }
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}>
                    <TokenLogo uri={item.token.imageUrl} symbol={item.token.symbol} size={42} />
                    <View style={{ flex: 1 }}>
                      <Text style={[common.cardTitle, { flexShrink: 1 }]} numberOfLines={2}>
                        ${item.token.symbol} · {item.token.name}
                      </Text>
                      {formatPairAgeHours(item.token.pairAgeHours) ? (
                        <Text style={[common.cardBody, { fontSize: 11 }]}>
                          {formatPairAgeHours(item.token.pairAgeHours)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <StatusBadge
                    label={testsPassed ? item.signalType : item.signalType === 'BUY' ? 'BUY BLOCKED' : item.signalType}
                    tone={toneForSignal(testsPassed ? item.signalType : item.signalType === 'BUY' ? 'NO_TRADE' : item.signalType)}
                  />
                </View>
                <Text style={common.cardBody}>
                  Safety {Math.round(item.safetyScore)} · Buy{' '}
                  {Math.round(item.buyScore ?? item.signalScore)}
                  {item.independent
                    ? ` · Agree ${item.independent.agreeing}/${item.independent.required}`
                    : ''}
                  {item.strategy ? ` · ${item.strategy.name}` : ''}
                </Text>
                {item.signalType !== 'BUY' && item.whyNotBuy ? (
                  <Text style={[common.cardBody, { color: colors.warn, marginTop: 4 }]}>
                    Why not buy: {item.whyNotBuy.items
                      .filter((x) => x.blocking && !x.passed)
                      .slice(0, 2)
                      .map((x) => x.label)
                      .join(' · ') || item.whyNotBuy.summary}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {buildTokenSourceTags({
                    marketSource: item.token.source,
                    jupiterPriceUsd: item.token.jupiterPriceUsd,
                    axiomUnavailable: item.axiomUnavailable,
                    safetyScore: item.safetyScore,
                  }).map((tag) => (
                    <StatusBadge key={tag} label={tag} tone="info" />
                  ))}
                  {item.chart ? (
                    <>
                      <StatusBadge label={`CHART ${item.chart.primary}`} tone="info" />
                      <StatusBadge label={`CONF ${item.chart.confirm}`} tone="info" />
                      <StatusBadge label={item.chart.style} tone="warn" />
                      {item.signalType === 'BUY' ? (
                        <BuyWindowTimer
                          chart={item.chart}
                          signalType={item.signalType}
                          testsPassed={testsPassed}
                          compact
                        />
                      ) : null}
                    </>
                  ) : null}
                </View>
                <Text style={common.cardBody}>
                  Entry {item.levels.entryMin.toPrecision(4)}–{item.levels.entryMax.toPrecision(4)}
                </Text>
                <Text style={common.cardBody}>
                  SL {item.levels.stopLoss.toPrecision(4)} ({item.levels.stopLossPct.toFixed(1)}%) ·
                  TP1 +{item.levels.tp1Pct}% · TP2 +{item.levels.tp2Pct}%
                </Text>
                {item.signalType !== 'BUY' ? (
                  <Text style={[common.cardBody, { marginTop: 8, color: colors.accent }]}>
                    Open token →
                  </Text>
                ) : null}
              </Pressable>
              <CopyableAddress address={item.token.address} compact />
              <View style={[common.row, { marginTop: 10 }]}>
                <Text style={[common.cardBody, { flex: 1 }]}>Auto-trade this coin when BUY passes</Text>
                <Switch
                  value={autoTradeAddresses.includes(item.token.address)}
                  onValueChange={(v) => {
                    void toggleAutoTrade(item.token.address, v).catch(() => undefined);
                  }}
                  trackColor={{ false: colors.border, true: colors.accent }}
                />
              </View>
              {testsPassed ? (
                <View style={{ marginTop: 10 }}>
                  <DexScreenerBuyButton
                    mint={item.token.address}
                    pairAddress={item.token.pairAddress}
                    compact
                  />
                </View>
              ) : (
                <Text style={[common.cardBody, { marginTop: 8, color: colors.muted, fontSize: 11 }]}>
                  Tap card for full details. BUY stays locked until every hard test passes.
                </Text>
              )}
            </View>
            );
          }}
        />
      )}
    </View>
  );
}
