import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  addToWatchlist,
  fetchWatchlist,
  removeFromWatchlist,
  type WatchlistItem,
} from '../api/client';
import { TokenRow } from '../components/TokenRow';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { useMemecoinAutoTrade } from '../settings/MemecoinAutoTradeContext';

export function WatchlistScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addresses: autoTradeAddresses, toggle: toggleAutoTrade } =
    useMemecoinAutoTrade();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWatchlist();
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load watchlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const add = async () => {
    if (!address.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addToWatchlist(address.trim());
      setAddress('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={common.screen}>
      <Text style={common.title}>Watchlist</Text>
      <Text style={common.subtitle}>
        Track tokens you care about. Tap any row for full analysis.
      </Text>

      <View style={[common.card, { gap: 8 }]}>
        <Text style={common.cardTitle}>Add token</Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="Mint address"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            color: colors.text,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: colors.bg,
          }}
        />
        <Pressable style={common.primaryBtn} onPress={() => void add()} disabled={busy}>
          <Text style={common.primaryBtnText}>{busy ? 'Adding…' : 'Add to watchlist'}</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={common.card}>
          <StatusBadge label="WATCHLIST ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.address}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            <Text style={common.cardBody}>
              Empty — add a mint or star tokens from Scanner / Token details.
            </Text>
          }
          renderItem={({ item }) => (
            <View>
              <TokenRow
                symbol={item.symbol}
                name={item.name}
                address={item.address}
                imageUrl={item.imageUrl}
                priceUsd={item.priceUsd}
                priceChange24h={item.priceChange24h}
                liquidityUsd={item.liquidityUsd}
                onPress={() =>
                  navigation.navigate('TokenDetails', { address: item.address })
                }
                autoTrade={autoTradeAddresses.includes(item.address)}
                onToggleAuto={(v) => {
                  void toggleAutoTrade(item.address, v).catch(() => undefined);
                }}
              />
              <Pressable
                onPress={() =>
                  void removeFromWatchlist(item.address).then(load).catch((e) =>
                    setError(e instanceof Error ? e.message : 'Remove failed'),
                  )
                }
                style={{ marginTop: -4, marginBottom: spacing.sm, paddingLeft: 4 }}
              >
                <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '600' }}>
                  Remove
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}
