import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchSwapTrades, type SwapTrade } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common, formatUsd } from '../theme';
import type { RootStackParamList } from '../navigation/types';

function tone(status: string): 'ok' | 'warn' | 'danger' | 'info' {
  if (status === 'CONFIRMED') return 'ok';
  if (status === 'FAILED' || status === 'REJECTED') return 'danger';
  if (status === 'PENDING' || status === 'SUBMITTED') return 'warn';
  return 'info';
}

export function TradeHistoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<SwapTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSwapTrades(80);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trades');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={common.screen}>
      <Text style={common.title}>Trade history</Text>
      <Text style={common.subtitle}>Only confirmed chain transactions are marked confirmed.</Text>
      {error ? (
        <View style={common.card}>
          <StatusBadge label="ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}
      {loading && items.length === 0 ? <ActivityIndicator color={colors.accent} /> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        ListEmptyComponent={!loading ? <Text style={common.cardBody}>No trades yet.</Text> : null}
        renderItem={({ item }) => (
          <Pressable
            style={common.card}
            onPress={() => navigation.navigate('TokenDetails', { address: item.tokenAddress })}
          >
            <View style={common.row}>
              <StatusBadge label={item.side} tone={item.side === 'BUY' ? 'ok' : 'warn'} />
              <StatusBadge label={item.status} tone={tone(item.status)} />
            </View>
            <Text style={common.cardTitle}>${item.symbol}</Text>
            <Text style={common.cardBody}>
              {formatUsd(item.amountUsd)} · {item.tokenQuantity.toPrecision(4)} tokens
            </Text>
            <Text style={common.cardBody}>
              Platform fee {formatUsd(item.platformFeeUsd)} · Network {formatUsd(item.networkFeeUsd)}
            </Text>
            {item.txSignature ? (
              <Text style={common.cardBody} numberOfLines={1}>
                {item.txSignature}
              </Text>
            ) : null}
            {item.errorMessage ? (
              <Text style={[common.cardBody, { color: colors.danger }]}>{item.errorMessage}</Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
