import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchDiscoveredWallet,
  fetchDiscoveredWallets,
  fetchSmartMoneySignals,
  type DiscoveredWalletRow,
} from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common, formatPct, spacing } from '../theme';

type SortKey =
  | 'smartScore'
  | 'roi'
  | 'winRate'
  | 'earlyEntryScore'
  | 'profitableCalls'
  | 'recent';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'smartScore', label: 'Score' },
  { key: 'roi', label: 'ROI' },
  { key: 'winRate', label: 'Win' },
  { key: 'earlyEntryScore', label: 'Early' },
  { key: 'profitableCalls', label: 'Calls' },
  { key: 'recent', label: 'Recent' },
];

function tierTone(tier: string): 'ok' | 'warn' | 'danger' | 'info' {
  if (tier === 'A') return 'ok';
  if (tier === 'B') return 'info';
  if (tier === 'C') return 'warn';
  return 'danger';
}

function formatHold(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '—';
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${Math.round(min)}m`;
  return `${(min / 60).toFixed(1)}h`;
}

export function SmartMoneyScreen() {
  const [sort, setSort] = useState<SortKey>('smartScore');
  const [items, setItems] = useState<DiscoveredWalletRow[]>([]);
  const [status, setStatus] = useState<string>('Discovery runs automatically — no manual wallet list required.');
  const [signals, setSignals] = useState<
    Array<{ symbol: string; overallScore: number; signal: string; reason: string; numberOfSmartWallets: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wallets, sigs] = await Promise.all([
        fetchDiscoveredWallets(sort),
        fetchSmartMoneySignals(8).catch(() => ({ items: [], count: 0 })),
      ]);
      setItems(wallets.items);
      setSignals(sigs.items);
      const s = wallets.status;
      setStatus(
        s.lastCycle
          ? `${s.tierA} Elite · ${s.tierB} Strong · ${s.tracked} tracked live · last scan ${new Date(s.lastCycle).toLocaleTimeString()}`
          : 'Waiting for the first automatic discovery cycle (about 40s after API start).',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wallets');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const visible = useMemo(
    () => items.filter((w) => !w.excluded && (w.tier === 'A' || w.tier === 'B' || w.tier === 'C')),
    [items],
  );

  return (
    <View style={common.screen}>
      <Text style={common.title}>Smart money</Text>
      <Text style={common.subtitle}>
        Auto-discovered wallets ranked by early meme-coin skill, not whale PnL. A wallet buy is an
        input into the score — never “wallet X bought, therefore BUY”.
      </Text>
      <Text style={[common.cardBody, { marginBottom: spacing.sm }]}>{status}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {SORTS.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => setSort(s.key)}
              style={[
                common.secondaryBtn,
                {
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  backgroundColor: sort === s.key ? colors.surfaceHover : colors.bgElevated,
                },
              ]}
            >
              <Text style={common.secondaryBtnText}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {signals.length ? (
        <View style={common.card}>
          <Text style={common.cardTitle}>Latest consensus</Text>
          {signals.slice(0, 3).map((sig) => (
            <Text key={`${sig.symbol}-${sig.overallScore}`} style={[common.cardBody, { marginTop: 6 }]}>
              ${sig.symbol} · {Math.round(sig.overallScore)}/100 · {sig.signal} · {sig.numberOfSmartWallets} wallets
            </Text>
          ))}
        </View>
      ) : null}

      {loading && !items.length ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : null}
      {error ? (
        <Text style={[common.cardBody, { color: colors.danger }]}>{error}</Text>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(w) => w.address}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={common.cardBody}>
              No scored wallets yet. The engine scans new/high-volume meme pools, then only keeps
              tracking high-quality names.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={async () => {
              const next = open === item.address ? null : item.address;
              setOpen(next);
              setDetail(null);
              if (next) {
                try {
                  const d = await fetchDiscoveredWallet(item.address);
                  const bt = d.backtest;
                  setDetail(
                    bt
                      ? `Walk-forward ${bt.consistent ? 'consistent' : 'uneven'} · avg move after entry ${(bt.avgGainAfterEntry * 100).toFixed(0)}% · fail ${(bt.failRate * 100).toFixed(0)}%${bt.likelyLuck ? ' · luck/concentration warning' : ''}`
                      : 'Not enough closed trades for a backtest yet (Tier C).',
                  );
                } catch {
                  setDetail('Could not load wallet history.');
                }
              }
            }}
            style={common.card}
          >
            <View style={common.row}>
              <Text style={common.cardTitle}>{item.label}</Text>
              <StatusBadge label={item.status} tone={tierTone(item.tier)} />
            </View>
            <Text selectable style={[common.cardBody, { marginTop: 4 }]}>
              {item.address}
            </Text>
            <View style={[common.row, { marginTop: 8 }]}>
              <View>
                <Text style={common.metricLabel}>Smart score</Text>
                <Text style={common.metric}>{Math.round(item.smartScore)}</Text>
              </View>
              <View>
                <Text style={common.metricLabel}>Win</Text>
                <Text style={common.metric}>{Math.round(item.winRate * 100)}%</Text>
              </View>
              <View>
                <Text style={common.metricLabel}>ROI</Text>
                <Text style={common.metric}>{formatPct(item.roi * 100)}</Text>
              </View>
              <View>
                <Text style={common.metricLabel}>Hold</Text>
                <Text style={common.metric}>{formatHold(item.averageHoldMin)}</Text>
              </View>
              <View>
                <Text style={common.metricLabel}>Early</Text>
                <Text style={common.metric}>{Math.round(item.earlyEntryScore)}</Text>
              </View>
            </View>
            <Text style={[common.cardBody, { marginTop: 6 }]}>
              {item.profitableCalls} successful meme calls · 24h {Math.round(item.windows.last24h)} · 7d{' '}
              {Math.round(item.windows.last7d)}
            </Text>
            {open === item.address && detail ? (
              <Text style={[common.cardBody, { marginTop: 8, color: colors.text }]}>{detail}</Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
