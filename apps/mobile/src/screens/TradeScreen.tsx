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
import { useFocusEffect } from '@react-navigation/native';
import {
  activateEmergencyStop,
  approveTrade,
  disableAutoTrading,
  enableAutoTrading,
  fetchAutoTradingStatus,
  fetchTradeProposals,
  prepareTrade,
  proposeTrade,
  rejectTrade,
  runAutoCycle,
  setKillSwitch,
  updateSettings,
  type AutoTradingStatus,
  type TradeProposal,
} from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { colors, common, spacing } from '../theme';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function fmt(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

export function TradeScreen() {
  const [status, setStatus] = useState<AutoTradingStatus | null>(null);
  const [items, setItems] = useState<TradeProposal[]>([]);
  const [address, setAddress] = useState(BONK);
  const [wallet, setWallet] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([
        fetchAutoTradingStatus(),
        fetchTradeProposals(),
      ]);
      setStatus(s);
      setItems(p.items);
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

  return (
    <View style={common.screen}>
      <Text style={common.title}>Real Trading</Text>
      <Text style={common.subtitle}>
        Manual approve-only by default. Optional auto is OFF unless you enable it with warnings.
        Dry-run only — no server private keys. Not financial advice.
      </Text>

      {error ? (
        <View style={common.card}>
          <StatusBadge label="TRADE ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}

      <View style={common.card}>
        <StatusBadge
          label={status?.killSwitchLabel ?? 'KILL SWITCH ON'}
          tone={status?.killSwitch ? 'danger' : 'warn'}
        />
        <StatusBadge label={status?.label ?? 'AUTO TRADING OFF'} tone="info" />
        <Text style={common.cardTitle}>Controls</Text>
        <Text style={common.cardBody}>{status?.reason ?? '—'}</Text>
        <Text style={[common.cardBody, { marginTop: spacing.sm }]}>
          Mode: {status?.tradingMode ?? '—'} · Exec: {status?.executionMode ?? 'dry_run'} ·
          Broadcast: {status?.realTradingBroadcast ? 'ON' : 'OFF'}
        </Text>
        {status?.warning ? (
          <Text style={[common.cardBody, { color: colors.danger, marginTop: spacing.sm }]}>
            {status.warning}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          <Pressable
            style={btn}
            onPress={() =>
              run(() => updateSettings({ tradingMode: 'MANUAL_REAL' }))
            }
            disabled={busy}
          >
            <Text style={btnText}>Set MANUAL_REAL</Text>
          </Pressable>
          <Pressable
            style={btn}
            onPress={() => run(() => setKillSwitch(false))}
            disabled={busy}
          >
            <Text style={btnText}>Kill switch OFF</Text>
          </Pressable>
          <Pressable
            style={btn}
            onPress={() => run(() => setKillSwitch(true))}
            disabled={busy}
          >
            <Text style={btnText}>Kill switch ON</Text>
          </Pressable>
          <Pressable
            style={[btn, { borderColor: colors.warn }]}
            onPress={() => run(() => enableAutoTrading())}
            disabled={busy}
          >
            <Text style={[btnText, { color: colors.warn }]}>Enable AUTO</Text>
          </Pressable>
          <Pressable
            style={btn}
            onPress={() => run(() => disableAutoTrading())}
            disabled={busy}
          >
            <Text style={btnText}>Disable AUTO</Text>
          </Pressable>
          <Pressable
            style={btn}
            onPress={() => run(() => runAutoCycle(3))}
            disabled={busy}
          >
            <Text style={btnText}>Run auto cycle</Text>
          </Pressable>
          <Pressable
            style={[btn, { borderColor: colors.danger }]}
            onPress={() => run(() => activateEmergencyStop())}
            disabled={busy}
          >
            <Text style={[btnText, { color: colors.danger }]}>Emergency stop</Text>
          </Pressable>
        </View>

        <Text style={[common.cardTitle, { marginTop: spacing.md }]}>Wallet pubkey</Text>
        <TextInput
          value={wallet}
          onChangeText={setWallet}
          placeholder="Solana public address only"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          style={input}
        />
        <Pressable
          style={[btn, { marginTop: spacing.sm }]}
          onPress={() =>
            run(() => updateSettings({ walletPublicKey: wallet.trim() || null }))
          }
          disabled={busy}
        >
          <Text style={btnText}>Save wallet</Text>
        </Pressable>
      </View>

      <View style={common.card}>
        <Text style={common.cardTitle}>Propose from mint</Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          autoCapitalize="none"
          style={input}
        />
        <Pressable
          style={[btn, { marginTop: spacing.sm }]}
          onPress={() => run(() => proposeTrade(address.trim()))}
          disabled={busy || !address.trim()}
        >
          <Text style={btnText}>{busy ? 'Working…' : 'Propose trade'}</Text>
        </Pressable>
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={loading || busy} onRefresh={load} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <Text style={common.cardBody}>No proposals yet.</Text>
          }
          renderItem={({ item }) => (
            <View style={common.card}>
              <StatusBadge
                label={item.status}
                tone={item.preTrade.allowed ? 'info' : 'danger'}
              />
              <Text style={common.cardTitle}>
                ${item.symbol} · ${item.positionSizeUsd.toFixed(2)}
              </Text>
              <Text style={common.cardBody}>
                Entry {fmt(item.entryPrice)} · SL {fmt(item.stopLoss)} · TP1{' '}
                {fmt(item.tp1Price)} · TP2 {fmt(item.tp2Price)}
              </Text>
              <Text style={common.cardBody}>
                Safety {Math.round(item.safetyScore)} · Signal{' '}
                {Math.round(item.signalScore)} · R:R {item.riskReward.toFixed(2)}
              </Text>
              {!item.preTrade.allowed ? (
                <Text style={[common.cardBody, { color: colors.danger, marginTop: 4 }]}>
                  Blocked: {item.preTrade.failed.join('; ')}
                </Text>
              ) : (
                <Text style={[common.cardBody, { marginTop: 4 }]}>
                  {item.beginner.decision}
                </Text>
              )}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                <Pressable
                  style={btn}
                  disabled={busy}
                  onPress={() => run(() => approveTrade(item.id))}
                >
                  <Text style={btnText}>Approve</Text>
                </Pressable>
                <Pressable
                  style={btn}
                  disabled={busy}
                  onPress={() => run(() => prepareTrade(item.id))}
                >
                  <Text style={btnText}>Prepare unsigned</Text>
                </Pressable>
                <Pressable
                  style={[btn, { borderColor: colors.warn }]}
                  disabled={busy}
                  onPress={() => run(() => rejectTrade(item.id))}
                >
                  <Text style={[btnText, { color: colors.warn }]}>Reject</Text>
                </Pressable>
              </View>
              {item.unsignedSwapTx ? (
                <Text style={[common.cardBody, { marginTop: spacing.sm }]} numberOfLines={2}>
                  Unsigned tx ready ({item.unsignedSwapTx.length} chars) — sign in wallet
                </Text>
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  );
}

const btn = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 8,
  backgroundColor: colors.surface,
} as const;

const btnText = {
  color: colors.text,
  fontSize: 13,
  fontWeight: '600' as const,
};

const input = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: colors.text,
  backgroundColor: colors.bg,
  marginTop: spacing.xs,
} as const;
