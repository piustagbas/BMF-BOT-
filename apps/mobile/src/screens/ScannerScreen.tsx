import React, { useCallback, useMemo, useState } from 'react';
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
  fetchTokens,
  type ScannerToken,
} from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { TokenRow } from '../components/TokenRow';
import { buildTokenSourceTags } from '../utils/sourceTags';
import { colors, common, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { useMemecoinAutoTrade } from '../settings/MemecoinAutoTradeContext';

type SortKey = 'volume' | 'liquidity' | 'marketCap' | 'priceChange' | 'safety';

export function ScannerScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<ScannerToken[]>([]);
  const [limit, setLimit] = useState(12);
  const [sort, setSort] = useState<SortKey>('safety');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addresses: autoTradeAddresses, toggle: toggleAutoTrade } =
    useMemecoinAutoTrade();

  const load = useCallback(async (nextSort = sort, nextQuery = query, nextLimit = limit) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTokens({
        sort: nextSort,
        limit: nextLimit,
        q: nextQuery.trim() || undefined,
      });
      setItems(res.items);
      setNote(res.note ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scanner');
      setNote(null);
    } finally {
      setLoading(false);
    }
  }, [limit, query, sort]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const sorts = useMemo(
    () =>
      [
        { key: 'volume' as const, label: 'Volume' },
        { key: 'liquidity' as const, label: 'Liquidity' },
        { key: 'safety' as const, label: 'Safety' },
        { key: 'marketCap' as const, label: 'MCap' },
        { key: 'priceChange' as const, label: 'Change' },
      ],
    [],
  );

  return (
    <View style={common.screen}>
      <Text style={common.title}>Live Scanner</Text>
      <Text style={common.subtitle}>
        Coins from 1 minute to 30 days old. Safety first — honeypot / mint-risk coins are ranked last.
        Tap a token for the full why-not-buy panel. Turn auto-trade on individual cards to fill
        only that coin when its BUY passes (same bar as Telegram).
      </Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search symbol or address"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 10,
          color: colors.text,
          paddingHorizontal: 12,
          paddingVertical: 10,
          marginBottom: spacing.sm,
        }}
        onSubmitEditing={() => void load(sort, query)}
        returnKeyType="search"
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
        {sorts.map((s) => (
          <Pressable
            key={s.key}
            onPress={() => {
              setSort(s.key);
              void load(s.key, query);
            }}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              backgroundColor: sort === s.key ? colors.accent + '33' : colors.surface,
              borderWidth: 1,
              borderColor: sort === s.key ? colors.accent : colors.border,
            }}
          >
            <Text style={{ color: sort === s.key ? colors.accent : colors.muted, fontSize: 12 }}>
              {s.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => void load(sort, query)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.info, fontSize: 12 }}>Refresh</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setLimit(30);
            void load(sort, query, 30);
          }}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: colors.accent + '22',
            borderWidth: 1,
            borderColor: colors.accent,
          }}
        >
          <Text style={{ color: colors.accent, fontSize: 12 }}>Fetch more coins</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={common.card}>
          <StatusBadge label="SCANNER ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}

      {note && !error ? (
        <Text style={[common.cardBody, { marginBottom: spacing.sm }]}>{note}</Text>
      ) : null}

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.address}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.accent} />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            !loading ? (
              <Text style={common.cardBody}>No tokens returned. Try another search.</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <TokenRow
              symbol={item.symbol}
              name={item.name}
              address={item.address}
              imageUrl={item.imageUrl}
              pairAgeHours={item.pairAgeHours}
              priceUsd={item.priceUsd}
              priceChange24h={item.priceChange24h}
              liquidityUsd={item.liquidityUsd}
              volume24h={item.volume24h}
              safetyScore={item.safetyScore}
              criticalWarning={item.criticalWarning}
              signalType={item.signalType ?? (item.safetyDecision === 'NO_TRADE' ? 'NO_TRADE' : null)}
              whyLine={item.safetySummary}
              sourceTags={buildTokenSourceTags({
                marketSource: item.feedSources ?? item.source,
                jupiterPriceUsd: item.jupiterPriceUsd,
                axiomUnavailable: item.axiomUnavailable,
                safetyScore: item.safetyScore,
              })}
              onPress={() =>
                navigation.navigate('TokenDetails', { address: item.address })
              }
              autoTrade={autoTradeAddresses.includes(item.address)}
              onToggleAuto={(v) => {
                void toggleAutoTrade(item.address, v).catch(() => undefined);
              }}
            />
          )}
        />
      )}
    </View>
  );
}
