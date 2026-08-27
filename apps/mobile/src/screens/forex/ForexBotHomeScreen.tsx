import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  emergencyForexStop,
  fetchForexBacktest,
  fetchForexCalendar,
  fetchForexJournal,
  fetchForexPositions,
  fetchForexScan,
  fetchForexStatus,
  setForexKillSwitch,
  tickForexPositions,
  type FxBoardRow,
  type FxPosition,
  type FxRisk,
  type FxSignal,
} from '../../api/client';
import { StatusBadge } from '../../components/StatusBadge';
import { colors, common, spacing } from '../../theme';
import type { ForexBotStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ForexBotStackParamList, 'ForexHome'>;
type Tab = 'SETUPS' | 'OPEN' | 'JOURNAL' | 'RISK' | 'LAB';

export function ForexBotHomeScreen({ navigation }: Props) {
  const [tab, setTab] = useState<Tab>('SETUPS');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [killSwitch, setKill] = useState(true);
  const [pipeline, setPipeline] = useState<string[]>([]);
  const [sessionNote, setSessionNote] = useState('');
  const [source, setSource] = useState('');
  const [disclaimer, setDisclaimer] = useState('');
  const [scoringNote, setScoringNote] = useState('');
  const [signals, setSignals] = useState<FxSignal[]>([]);
  const [board, setBoard] = useState<FxBoardRow[]>([]);
  const [rejected, setRejected] = useState<Array<{ symbol: string; stage: string; reasons: string[] }>>([]);
  const [positions, setPositions] = useState<FxPosition[]>([]);
  const [risk, setRisk] = useState<FxRisk | null>(null);
  const [journalNote, setJournalNote] = useState('');
  const [journalItems, setJournalItems] = useState<Array<{ id: string; symbol: string; side: string; pnlUsd: number; exitReason: string }>>([]);
  const [calendar, setCalendar] = useState<string>('');
  const [lab, setLab] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scan = await fetchForexScan();
      const [st, pos, journal, cal, bt] = await Promise.all([
        fetchForexStatus().catch(() => null),
        fetchForexPositions().catch(() => ({ items: [] as FxPosition[] })),
        fetchForexJournal().catch(() => null),
        fetchForexCalendar().catch(() => null),
        fetchForexBacktest().catch(() => null),
      ]);
      if (st) {
        setKill(st.killSwitch);
        setPipeline(st.pipeline);
        setScoringNote(st.scoringNote);
        setDisclaimer(st.disclaimer);
        setSessionNote(scan.session?.note || st.session.note);
      } else {
        setSessionNote(scan.session?.note || '');
        setDisclaimer(scan.disclaimer);
      }
      setSource(scan.source || '');
      setSignals(scan.signals ?? []);
      setBoard(scan.board ?? []);
      setRejected(scan.rejected ?? []);
      setRisk(scan.risk ?? null);
      setPositions(pos.items);
      if (scan.halt) setError(scan.halt);
      if (journal) {
        setJournalItems(journal.items.slice(0, 20));
        const a = journal.analytics;
        setJournalNote(
          `${a.trades} trades · win ${a.winRatePct ?? '—'}% · exp ${a.expectancyUsd ?? '—'} USD · ${a.note}`,
        );
      }
      if (cal) {
        const active = cal.active.map((e) => `${e.name} ${e.currency}`).join(' · ') || 'No active blackout';
        setCalendar(active);
      }
      if (bt) {
        setLab(`${bt.report.passed ? 'OOS PASS' : 'OOS HOLD'} — ${bt.requirement}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to scan FX markets');
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

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'SETUPS', label: 'Pairs' },
    { key: 'OPEN', label: 'Open' },
    { key: 'JOURNAL', label: 'Journal' },
    { key: 'RISK', label: 'Risk' },
    { key: 'LAB', label: 'Lab' },
  ];

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={{ paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={common.title}>FX BOT</Text>
      <Text style={common.subtitle}>
        Live Yahoo quotes. Telegram/email when BUY or SELL hits 60%+ (every 3 min). Tap the button to recheck before any paper fill.
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
        {(pipeline.length ? pipeline : ['SCAN', 'FILTER', 'ANALYZE', 'SCORE', 'VALIDATE', 'NOTIFY']).map((s) => (
          <View key={s} style={[common.badge, { backgroundColor: colors.info + '22', marginRight: 6 }]}>
            <Text style={[common.badgeText, { color: colors.info }]}>{s}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[common.row, { marginBottom: spacing.sm }]}>
        <StatusBadge label={killSwitch ? 'KILL SWITCH ON' : 'KILL SWITCH OFF'} tone={killSwitch ? 'danger' : 'ok'} />
        <StatusBadge label="PAPER / DEMO" tone="info" />
      </View>
      <Text style={[common.cardBody, { marginBottom: spacing.sm }]}>{sessionNote}</Text>
      {source ? <Text style={[common.cardBody, { marginBottom: spacing.sm }]}>{source}</Text> : null}

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.sm }}>
        <Pressable
          style={[common.secondaryBtn, { flex: 1 }]}
          disabled={busy}
          onPress={() => void run(() => setForexKillSwitch(!killSwitch))}
        >
          <Text style={common.secondaryBtnText}>{killSwitch ? 'Disable kill switch' : 'Arm kill switch'}</Text>
        </Pressable>
        <Pressable
          style={[common.secondaryBtn, { flex: 1, borderColor: colors.danger }]}
          disabled={busy}
          onPress={() => void run(() => emergencyForexStop())}
        >
          <Text style={[common.secondaryBtnText, { color: colors.danger }]}>Emergency stop</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={common.card}>
          <StatusBadge label="FX BOT" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
        {tabs.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[
              common.badge,
              {
                backgroundColor: tab === t.key ? colors.info : colors.surface,
                marginRight: 6,
                borderWidth: 1,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[common.badgeText, { color: tab === t.key ? '#041018' : colors.text }]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading && !board.length && tab === 'SETUPS' ? (
        <ActivityIndicator color={colors.accent} />
      ) : null}

      {tab === 'SETUPS'
        ? board.map((row) => {
            const tone = row.bias === 'BUY' ? 'ok' : row.bias === 'SELL' ? 'danger' : 'warn';
            const change = `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%`;
            const open = (side: 'BUY' | 'SELL') => {
              if (!row.signalId) return;
              navigation.navigate('ForexSignal', { id: row.signalId, side });
            };
            return (
              <View key={row.symbol} style={common.card}>
                <View style={common.row}>
                  <Text style={common.cardTitle}>{row.symbol}</Text>
                  <StatusBadge label={`${row.bias} ${row.bias === 'WAIT' ? row.setupQuality : row.bias === 'BUY' ? row.buyPct : row.sellPct}%`} tone={tone} />
                </View>
                <Text style={[common.metric, { fontSize: 22 }]}>
                  {row.mid.toFixed(row.symbol.includes('JPY') || row.symbol === 'XAUUSD' ? 3 : 5)}
                </Text>
                <Text style={[common.cardBody, { color: row.changePct >= 0 ? colors.positive : colors.negative }]}>
                  {change} · {row.changePips >= 0 ? '+' : ''}
                  {row.changePips.toFixed(1)} pips · spread {row.spreadPips.toFixed(1)}
                </Text>
                <Text style={[common.cardBody, { marginTop: 6, color: colors.text, fontWeight: '700' }]}>
                  BUY {row.buyPct}% · SELL {row.sellPct}% · quality {row.setupQuality}/100
                </Text>
                <Text style={common.cardBody}>
                  Bid {row.bid} · Ask {row.ask}
                  {row.rsi != null ? ` · RSI ${row.rsi.toFixed(0)}` : ''}
                  {row.atrPips != null ? ` · ATR ${row.atrPips} pips` : ''}
                </Text>
                {row.zone ? (
                  <Text style={common.cardBody}>
                    Zone {row.zone.low} – {row.zone.high}
                    {row.stopLoss != null ? ` · SL ${row.stopLoss}` : ''}
                    {row.takeProfit1 != null ? ` · TP1 ${row.takeProfit1}` : ''}
                  </Text>
                ) : null}
                <Text style={[common.cardBody, { marginTop: 4 }]} numberOfLines={3}>
                  {row.reasons[0] || row.blockers[0] || 'Scanning…'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Pressable
                    style={[common.primaryBtn, { flex: 1, opacity: row.signalId && row.bias !== 'SELL' ? 1 : 0.4 }]}
                    disabled={!row.signalId || row.bias === 'SELL'}
                    onPress={() => open('BUY')}
                  >
                    <Text style={common.primaryBtnText}>BUY {row.buyPct}%</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      common.secondaryBtn,
                      { flex: 1, borderColor: colors.danger, opacity: row.signalId && row.bias !== 'BUY' ? 1 : 0.4 },
                    ]}
                    disabled={!row.signalId || row.bias === 'BUY'}
                    onPress={() => open('SELL')}
                  >
                    <Text style={[common.secondaryBtnText, { color: colors.danger }]}>SELL {row.sellPct}%</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        : null}

      {tab === 'SETUPS' && !board.length && !loading ? (
        <View style={common.card}>
          <Text style={common.cardTitle}>No prices yet</Text>
          <Text style={common.cardBody}>
            Pull to refresh. The bot fetches live Yahoo FX charts, then scores BUY vs SELL for each pair.
            {rejected.length ? ` ${rejected.length} pairs were filtered.` : ''}
          </Text>
        </View>
      ) : null}

      {tab === 'OPEN'
        ? positions.map((p) => (
            <View key={p.id} style={common.card}>
              <View style={common.row}>
                <Text style={common.cardTitle}>
                  {p.symbol} {p.side} · {p.lotsOpen} lots
                </Text>
                <StatusBadge label={p.pipeline.stage} tone="info" />
              </View>
              <Text style={common.cardBody}>
                Entry {p.entry} · SL {p.sl} · uPnL {p.unrealizedUsd.toFixed(2)} USD
              </Text>
              <Text style={common.cardBody}>
                {p.tp1Filled ? 'TP1 done · BE on' : 'TP1 pending'}
                {p.trailingOn ? ' · trailing remainder' : ''}
              </Text>
              <Pressable
                style={[common.secondaryBtn, { marginTop: 8 }]}
                onPress={() => void run(() => tickForexPositions())}
              >
                <Text style={common.secondaryBtnText}>Monitor / manage now</Text>
              </Pressable>
            </View>
          ))
        : null}
      {tab === 'OPEN' && !positions.length ? (
        <Text style={common.cardBody}>No open paper positions. Setups never auto-trade — you click BUY/SELL.</Text>
      ) : null}

      {tab === 'JOURNAL' ? (
        <View style={common.card}>
          <Text style={common.cardTitle}>Performance</Text>
          <Text style={common.cardBody}>{journalNote || 'No closed paper trades yet.'}</Text>
          {journalItems.map((j) => (
            <Text key={j.id} style={[common.cardBody, { marginTop: 6 }]}>
              {j.symbol} {j.side} · {j.pnlUsd.toFixed(2)} USD · {j.exitReason}
            </Text>
          ))}
        </View>
      ) : null}

      {tab === 'RISK' && risk ? (
        <View style={common.card}>
          <Text style={common.cardTitle}>Exposure</Text>
          <Text style={common.metric}>${risk.equity.toFixed(2)}</Text>
          <Text style={common.metricLabel}>Equity · paper</Text>
          <Text style={[common.cardBody, { marginTop: 8 }]}>
            Daily DD {risk.dailyDrawdownPct.toFixed(2)}% {risk.dailyHalt ? '(HALT)' : ''} · weekly{' '}
            {risk.weeklyDrawdownPct.toFixed(2)}% {risk.weeklyHalt ? '(HALT)' : ''}
          </Text>
          <Text style={common.cardBody}>
            Open {risk.openPositions}/{risk.maxOpen} · USD exposure {risk.usdExposureLots} lots
          </Text>
          <Text style={common.cardBody}>{calendar}</Text>
          {risk.correlationBlocks.map((b) => (
            <Text key={b} style={[common.cardBody, { color: colors.warn }]}>
              {b}
            </Text>
          ))}
          <Text style={[common.cardBody, { marginTop: 8 }]}>{risk.liveBlockedReason}</Text>
        </View>
      ) : null}

      {tab === 'LAB' ? (
        <View style={common.card}>
          <Text style={common.cardTitle}>Backtest + forward-test</Text>
          <Text style={common.cardBody}>{lab || scoringNote}</Text>
          <Text style={[common.cardBody, { marginTop: 8 }]}>
            Anti-overfit: walk-forward IS vs OOS, minimum trade count, OOS expectancy must stay positive,
            and a 90/100 score is not a 90% win rate.
          </Text>
        </View>
      ) : null}

      <Text style={[common.cardBody, { marginTop: spacing.md }]}>{disclaimer}</Text>
    </ScrollView>
  );
}
