import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchSwapPortfolio, type SwapPosition } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common, formatPct, formatUsd, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { useWallet } from '../wallet/WalletContext';

export function PortfolioScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const wallet = useWallet();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(0);
  const [pnl, setPnl] = useState(0);
  const [items, setItems] = useState<SwapPosition[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await fetchSwapPortfolio();
      setItems(p.positions);
      setValue(p.totalValueUsd);
      setPnl(p.unrealizedPnlUsd);
      await wallet.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScrollView
      style={common.screen}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={common.title}>Portfolio</Text>
      <Text style={common.subtitle}>
        Positions update after an on-chain confirmation — never from a simulated fill.
      </Text>
      {error ? (
        <View style={common.card}>
          <StatusBadge label="ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}
      <View style={common.card}>
        <Text style={common.cardTitle}>Open value</Text>
        <Text style={common.metric}>{formatUsd(value)}</Text>
        <Text style={{ color: pnl >= 0 ? colors.positive : colors.negative, marginTop: 4, fontWeight: '700' }}>
          {formatUsd(pnl)} unrealized
        </Text>
        {wallet.address ? (
          <Text style={[common.cardBody, { marginTop: 8 }]}>
            {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)} · SOL {wallet.solBalance.toFixed(4)}
          </Text>
        ) : (
          <Text style={[common.cardBody, { marginTop: 8 }]}>Connect a wallet from a token page to trade.</Text>
        )}
      </View>
      {loading && items.length === 0 ? <ActivityIndicator color={colors.accent} /> : null}
      {items.length === 0 && !loading ? (
        <Text style={common.cardBody}>No open positions yet. Buy a token to see it here.</Text>
      ) : null}
      {items.map((p) => (
        <Pressable
          key={p.id}
          style={common.card}
          onPress={() => navigation.navigate('TokenDetails', { address: p.tokenAddress, action: 'SELL' })}
        >
          <View style={common.row}>
            <Text style={common.cardTitle}>${p.symbol}</Text>
            <StatusBadge label={p.roiPct >= 0 ? formatPct(p.roiPct) : formatPct(p.roiPct)} tone={p.roiPct >= 0 ? 'ok' : 'danger'} />
          </View>
          <Text style={common.cardBody}>
            Qty {p.qty.toPrecision(6)} · Avg {formatUsd(p.avgEntry)} · Now {formatUsd(p.currentPrice)}
          </Text>
          <Text style={common.cardBody}>
            Value {formatUsd(p.currentValue)} · PnL {formatUsd(p.unrealizedPnlUsd)}
          </Text>
          {p.takeProfitPct ? (
            <Text style={[common.cardBody, { marginTop: spacing.xs }]}>
              TP +{p.takeProfitPct}% {p.takeProfitPrice ? `(${formatUsd(p.takeProfitPrice)})` : ''} · alert only
            </Text>
          ) : null}
          {p.stopLossPct ? (
            <Text style={common.cardBody}>
              SL -{p.stopLossPct}% {p.stopLossPrice ? `(${formatUsd(p.stopLossPrice)})` : ''} · alert only
            </Text>
          ) : null}
          <Text style={{ color: colors.accent, marginTop: 8, fontWeight: '700' }}>Sell →</Text>
        </Pressable>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
