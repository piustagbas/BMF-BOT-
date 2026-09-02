import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DISCLAIMER } from '@memecoinbot/shared';
import {
  fetchAutoTradingStatus,
  fetchHealth,
  fetchPaperDashboard,
  fetchSignals,
  type AutoTradingStatus,
  type HealthPayload,
  type PaperDashboard,
  type SignalItem,
} from '../api/client';
import { AppLogo } from '../components/AppLogo';
import { StatusBadge } from '../components/StatusBadge';
import { TokenRow } from '../components/TokenRow';
import { colors, common, formatPct, formatUsd, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { HEALTH_SOURCE_CODE, buildTokenSourceTags } from '../utils/sourceTags';
import { useMemecoinAutoTrade } from '../settings/MemecoinAutoTradeContext';

export function DashboardScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openToken = (tokenAddress: string) => {
    const rootNavigation =
      navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
    (rootNavigation ?? navigation).navigate('TokenDetails', {
      address: tokenAddress,
    });
  };
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [auto, setAuto] = useState<AutoTradingStatus | null>(null);
  const [paper, setPaper] = useState<PaperDashboard | null>(null);
  const [signals, setSignals] = useState<SignalItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { addresses: autoTradeAddresses, toggle: toggleAutoTrade } =
    useMemecoinAutoTrade();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, a, p, s] = await Promise.all([
        fetchHealth(),
        fetchAutoTradingStatus(),
        fetchPaperDashboard().catch(() => null),
        fetchSignals({ limit: 12 }).catch(() => ({ items: [] as SignalItem[] })),
      ]);
      setHealth(h);
      setAuto(a);
      setPaper(p);
      setSignals(s.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const perf = paper?.performance;
  const topSetups = signals.filter((s) => s.signalType === 'BUY' || s.signalType === 'WATCH');
  const displayedSignals = useMemo(() => {
    const source = topSetups.length >= 10 ? topSetups : signals;
    const seen = new Set<string>();
    return source
      .filter((item) => {
        if (seen.has(item.token.address)) return false;
        seen.add(item.token.address);
        return true;
      })
      .slice(0, 10);
  }, [signals, topSetups]);

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <AppLogo size={44} />
        <Text style={[common.title, { marginBottom: 0 }]}>BMF Bot</Text>
      </View>
      <Text style={common.subtitle}>
        Live Solana meme analysis · paper-first · potential setups only
      </Text>

      {error ? (
        <View style={common.card}>
          <StatusBadge label="API OFFLINE" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
          <Pressable onPress={load} style={{ marginTop: 10 }}>
            <Text style={{ color: colors.info, fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {loading && !health ? <ActivityIndicator color={colors.accent} /> : null}

      {health ? (
        <View style={common.card}>
          <View style={common.row}>
            <StatusBadge
              label={health.status}
              tone={
                health.status === 'ONLINE'
                  ? 'ok'
                  : health.status === 'DEGRADED'
                    ? 'warn'
                    : 'danger'
              }
            />
            <StatusBadge
              label={autoTradeAddresses.length > 0 ? 'MEME AUTO ON' : 'MEME AUTO OFF'}
              tone={autoTradeAddresses.length > 0 ? 'warn' : 'ok'}
            />
            <StatusBadge
              label={auto?.autoTradeForex ? 'FX AUTO ON' : 'FX AUTO OFF'}
              tone={auto?.autoTradeForex ? 'warn' : 'ok'}
            />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <StatusBadge label={health.tradingMode} tone="info" />
            <StatusBadge
              label={health.killSwitch ? 'KILL ON' : 'KILL OFF'}
              tone={health.killSwitch ? 'ok' : 'warn'}
            />
          </View>
        </View>
      ) : null}

      {perf ? (
        <View style={common.card}>
          <Text style={common.cardTitle}>Demo desk</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
            <View style={{ minWidth: '40%' }}>
              <Text style={common.metricLabel}>Equity</Text>
              <Text style={common.metric}>{formatUsd(perf.equity)}</Text>
            </View>
            <View style={{ minWidth: '40%' }}>
              <Text style={common.metricLabel}>P/L</Text>
              <Text
                style={[
                  common.metric,
                  { color: perf.totalPnl >= 0 ? colors.positive : colors.negative },
                ]}
              >
                {formatUsd(perf.totalPnl)} ({formatPct(perf.totalPnlPct)})
              </Text>
            </View>
            <View style={{ minWidth: '40%' }}>
              <Text style={common.metricLabel}>Win rate</Text>
              <Text style={common.metric}>{formatPct(perf.winRate)}</Text>
            </View>
            <View style={{ minWidth: '40%' }}>
              <Text style={common.metricLabel}>Open</Text>
              <Text style={common.metric}>{perf.openPositions}</Text>
            </View>
          </View>
        </View>
      ) : null}

      <View style={common.card}>
        <View style={common.row}>
        <Text style={common.cardTitle}>Recent signals</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {displayedSignals.length} coins
          </Text>
        </View>
        {displayedSignals.length === 0 ? (
          <Text style={common.cardBody}>
            No recent signals yet. Open Signals and run a live scan.
          </Text>
        ) : (
          displayedSignals.map((item) => (
            <View key={`${item.token.address}-${item.generatedAt}`} style={{ marginTop: spacing.sm }}>
              <TokenRow
                symbol={item.token.symbol}
                name={item.token.name}
                address={item.token.address}
                imageUrl={item.token.imageUrl}
                pairAgeHours={item.token.pairAgeHours}
                priceUsd={item.token.priceUsd}
                liquidityUsd={item.token.liquidityUsd}
                volume24h={item.token.volume24h}
                safetyScore={item.safetyScore}
                signalType={item.signalType}
                sourceTags={buildTokenSourceTags({
                  marketSource: item.token.source,
                  jupiterPriceUsd: item.token.jupiterPriceUsd,
                  axiomUnavailable: item.axiomUnavailable,
                  safetyScore: item.safetyScore,
                })}
                onPress={() => openToken(item.token.address)}
                autoTrade={autoTradeAddresses.includes(item.token.address)}
                onToggleAuto={(v) => {
                  void toggleAutoTrade(item.token.address, v).catch(() => undefined);
                }}
              />
            </View>
          ))
        )}
      </View>

      {health ? (
        <View style={common.card}>
          <Text style={common.cardTitle}>Data sources</Text>
          {Object.entries(health.sources).map(([key, value]) => (
            <View key={key} style={[common.row, { marginTop: 6 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <StatusBadge label={HEALTH_SOURCE_CODE[key] ?? key.slice(0, 3).toUpperCase()} tone="info" />
                <Text style={common.cardBody}>{key}</Text>
              </View>
              <StatusBadge
                label={value.status}
                tone={
                  value.status === 'ONLINE'
                    ? 'ok'
                    : value.status === 'DEGRADED'
                      ? 'warn'
                      : 'danger'
                }
              />
            </View>
          ))}
        </View>
      ) : null}

      <View style={common.card}>
        <Text style={common.cardTitle}>Disclaimer</Text>
        <Text style={common.cardBody}>{DISCLAIMER}</Text>
      </View>
    </ScrollView>
  );
}
