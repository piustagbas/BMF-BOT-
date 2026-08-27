import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { fetchSignalResults } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Filter = 'ALL' | 'SUCCESS' | 'FAIL' | 'OPEN';

type ResultItem = Awaited<ReturnType<typeof fetchSignalResults>>['items'][number];

function tone(result: ResultItem['result']): 'ok' | 'danger' | 'warn' {
  if (result === 'SUCCESS') return 'ok';
  if (result === 'FAIL') return 'danger';
  return 'warn';
}

export function OutcomesScreen() {
  const navigation = useNavigation();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchSignalResults>> | null>(
    null,
  );
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSignalResults({ refresh }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load results');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load]),
  );

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    if (filter === 'ALL') return items;
    return items.filter((i) => i.result === filter);
  }, [data, filter]);

  return (
    <View style={common.screen}>
      <Text style={common.title}>BUY results</Text>
      <Text style={common.subtitle}>
        Tracks BUY setups you did not have to take. SUCCESS = price hit TP1/TP2 first.
        FAIL = stop hit first. Not financial advice.
      </Text>

      <View style={common.card}>
        <Text style={common.cardBody}>
          Success {data?.success ?? 0} · Fail {data?.fail ?? 0} · Open {data?.open ?? 0}
          {data?.successRatePct != null ? ` · Hit rate ${data.successRatePct}%` : ''}
        </Text>
        <Text style={[common.cardBody, { marginTop: 6 }]}>
          {data?.note ??
            'A BUY must appear first (scan or open token). Then this screen grades later candles.'}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
        {(['ALL', 'SUCCESS', 'FAIL', 'OPEN'] as Filter[]).map((key) => {
          const active = filter === key;
          return (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
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
                {key}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <View style={common.card}>
          <StatusBadge label="RESULTS ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}

      {loading && !data ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void load(true)}
              tintColor={colors.accent}
            />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            !loading ? (
              <Text style={common.cardBody}>
                No BUY setups logged yet. When a token shows BUY, it is saved here even if you
                skip it. Pull to refresh later.
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                const root = navigation.getParent()?.getParent() as
                  | NativeStackNavigationProp<RootStackParamList>
                  | undefined;
                root?.navigate('TokenDetails', { address: item.address });
              }}
              style={common.card}
            >
              <View style={common.row}>
                <Text style={common.cardTitle}>${item.symbol}</Text>
                <StatusBadge label={item.result} tone={tone(item.result)} />
              </View>
              <Text style={common.cardBody}>
                Safety {Math.round(item.safetyScore)} · Buy {Math.round(item.buyScore)} ·{' '}
                {new Date(item.generatedAt).toLocaleString()}
              </Text>
              <Text style={common.cardBody}>
                Entry {item.entry.toPrecision(4)} · SL {item.stopLoss.toPrecision(4)} · TP1{' '}
                {item.tp1Price.toPrecision(4)}
              </Text>
              {item.outcome ? (
                <Text style={common.cardBody}>
                  First {item.outcome.firstExit} · MFE {item.outcome.mfePct.toFixed(1)}% · MAE{' '}
                  {item.outcome.maePct.toFixed(1)}%
                </Text>
              ) : null}
              {item.error ? (
                <Text style={[common.cardBody, { color: colors.warn }]}>{item.error}</Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
