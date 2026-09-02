import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  executeForexSignal,
  fetchForexPair,
  fetchForexStatus,
  recheckForexSignal,
  type FxPairDetail,
  type FxSide,
} from '../../api/client';
import { StatusBadge } from '../../components/StatusBadge';
import { WhyNotBuyPanel } from '../../components/WhyNotBuyPanel';
import { CandlestickChart } from '../../components/CandlestickChart';
import { colors, common, spacing } from '../../theme';
import type { ForexBotStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ForexBotStackParamList, 'ForexSignal'>;

const FX_TFS = ['5m', '15m', '30m', '1h', '1d'];

export function ForexSignalScreen({ route, navigation }: Props) {
  const { symbol, id: routeId, side: routeSide } = route.params;
  const [pair, setPair] = useState<FxPairDetail | null>(null);
  const [chartTf, setChartTf] = useState('15m');
  const [killSwitch, setKillSwitch] = useState(true);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<FxSide | undefined>(routeSide);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [ok, setOk] = useState(false);
  const [note, setNote] = useState('');
  const [fillMsg, setFillMsg] = useState<string | null>(null);

  const signalId = pair?.signal?.id ?? routeId;

  const loadPair = useCallback(
    async (tf: string, background = false) => {
      if (background) setChartLoading(true);
      else setLoading(true);
      setError(null);
      try {
        const [detail, st] = await Promise.all([fetchForexPair(symbol, tf), fetchForexStatus()]);
        setPair(detail);
        setKillSwitch(st.killSwitch);
        navigation.setOptions({ title: detail.symbol });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load pair');
      } finally {
        setLoading(false);
        setChartLoading(false);
      }
    },
    [symbol, navigation],
  );

  const chartTfRef = useRef(chartTf);
  chartTfRef.current = chartTf;

  useFocusEffect(
    useCallback(() => {
      void loadPair(chartTfRef.current);
    }, [loadPair]),
  );

  useEffect(() => {
    if (!signalId || !side) {
      setOk(false);
      setBlockers([]);
      setNote('');
      setRechecking(false);
      return;
    }
    let cancelled = false;
    setRechecking(true);
    setOk(false);
    setNote(`Rechecking live ${side}…`);
    (async () => {
      try {
        const check = await recheckForexSignal(signalId, side);
        if (cancelled) return;
        setOk(check.ok);
        setBlockers(check.blockers);
        setNote(
          check.ok
            ? `Live recheck passed · still in zone · spread ${check.spreadPips ?? '—'} pips`
            : 'Recheck failed — demo trade will not fill',
        );
      } catch (e) {
        if (cancelled) return;
        setOk(false);
        setError(e instanceof Error ? e.message : 'Failed to recheck');
        setNote('Recheck failed — demo trade will not fill');
      } finally {
        if (!cancelled) setRechecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signalId, side]);

  const confirm = async (requested?: FxSide) => {
    const analysis = pair?.analysis;
    const buyActive = analysis?.bias === 'BUY' && analysis.tradeable;
    const sellActive = analysis?.bias === 'SELL' && analysis.tradeable;
    const useSide =
      requested ??
      side ??
      (buyActive ? 'BUY' : sellActive ? 'SELL' : undefined);

    if (!useSide) {
      const msg = 'Tap BUY or SELL first — only when that button is active (green / enabled).';
      setError(msg);
      Alert.alert('Demo trade', msg);
      return;
    }
    if (!buyActive && useSide === 'BUY' && side !== 'BUY') {
      const msg = 'BUY is not active on this pair. Demo trade only fills when BUY is enabled.';
      setError(msg);
      Alert.alert('Demo trade', msg);
      return;
    }
    if (!signalId) {
      const msg = 'No fillable setup for this pair yet. Wait for a SAFE BUY/SELL, then try again.';
      setError(msg);
      Alert.alert('Demo trade', msg);
      return;
    }

    setSide(useSide);
    setBusy(true);
    setError(null);
    setFillMsg(null);
    setNote(`Opening demo ${useSide}…`);
    try {
      const check = await recheckForexSignal(signalId, useSide);
      setOk(check.ok);
      setBlockers(check.blockers);
      if (!check.ok) {
        const why = check.blockers.join('\n') || 'Live recheck failed';
        setNote('Demo blocked — recheck failed');
        setError(why);
        Alert.alert('Demo trade blocked', why);
        return;
      }
      const result = await executeForexSignal(signalId, useSide);
      const msg = `Demo ${useSide} filled at ${result.fill} · ${result.position.lotsOpen} lots`;
      setFillMsg(msg);
      setNote(msg);
      Alert.alert('Demo trade filled', `${pair?.symbol ?? symbol} ${msg}. Watch it on the Open tab.`, [
        {
          text: 'View position',
          onPress: () =>
            navigation.replace('ForexHome', {
              tab: 'OPEN',
              notice: `${pair?.symbol ?? symbol} ${msg}`,
            }),
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Demo trade blocked';
      setError(msg);
      setNote('Demo trade did not fill');
      Alert.alert('Demo trade blocked', msg);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !pair) {
    return (
      <View style={[common.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const analysis = pair?.analysis;
  const digits = symbol.includes('JPY') || symbol === 'XAUUSD' ? 3 : 5;
  const buyActive = Boolean(analysis?.bias === 'BUY' && analysis.tradeable);
  const sellActive = Boolean(analysis?.bias === 'SELL' && analysis.tradeable);
  const demoSide = side ?? (buyActive ? 'BUY' : sellActive ? 'SELL' : undefined);
  const canFill = Boolean(!busy && signalId && demoSide && (ok || rechecking || buyActive || sellActive));

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={
        <RefreshControl
          refreshing={loading || chartLoading}
          onRefresh={() => void loadPair(chartTf)}
          tintColor={colors.accent}
        />
      }
    >
      {pair ? (
        <>
          <Text style={common.title}>
            {pair.symbol}
            {side ? ` ${side}` : analysis?.bias && analysis.bias !== 'WAIT' ? ` ${analysis.bias}` : ''}
          </Text>
          <Text style={common.subtitle}>
            Same as memecoin: tap a card to read the candles and why not to buy. Demo fill still rechecks
            Yahoo quotes, zone, spread, and session.
          </Text>
          <View style={[common.row, { marginBottom: spacing.sm, flexWrap: 'wrap', gap: 6 }]}>
            <StatusBadge
              label={`QUALITY ${analysis?.setupQuality ?? '—'}/100`}
              tone="info"
            />
            <StatusBadge
              label={`BUY ${analysis?.buyPct ?? '—'}%`}
              tone={buyActive ? 'ok' : 'warn'}
            />
            <StatusBadge
              label={`SELL ${analysis?.sellPct ?? '—'}%`}
              tone={sellActive ? 'danger' : 'warn'}
            />
            <StatusBadge
              label={pair.quote.dataQuality}
              tone={pair.quote.dataQuality === 'LIVE' ? 'ok' : pair.quote.dataQuality === 'DEGRADED' ? 'warn' : 'danger'}
            />
            {pair.candlestick.pattern !== 'NONE' ? (
              <StatusBadge label={pair.candlestick.pattern.replace(/_/g, ' ')} tone="info" />
            ) : null}
          </View>

          <CandlestickChart
            candles={pair.candles}
            timeframe={chartTf}
            loading={chartLoading}
            error={pair.candles.length ? null : 'No candles yet'}
            onSelectTimeframe={(tf) => {
              setChartTf(tf);
              void loadPair(tf, true);
            }}
            timeframes={FX_TFS}
            livePrice={pair.quote.mid}
            levels={
              analysis?.zone
                ? {
                    entryMin: analysis.zone.low,
                    entryMax: analysis.zone.high,
                    stopLoss: analysis.stopLoss ?? undefined,
                  }
                : null
            }
          />

          <View style={common.card}>
            <Text style={common.cardTitle}>Candlestick signal</Text>
            <Text style={common.cardBody}>
              {pair.candlestick.pattern.replace(/_/g, ' ')} · score {Math.round(pair.candlestick.score)}/100 ·
              {pair.candlestick.bullish ? ' bullish' : ' not bullish'} · close {pair.candlestick.closeLocation.toLowerCase()}
            </Text>
            {pair.candlestick.notes.map((n) => (
              <Text key={n} style={[common.cardBody, { marginTop: 4 }]}>
                {n}
              </Text>
            ))}
            {analysis?.rsi != null ? (
              <Text style={[common.cardBody, { marginTop: 6 }]}>RSI {analysis.rsi.toFixed(0)}</Text>
            ) : null}
          </View>

          {pair.whyNotBuy ? <WhyNotBuyPanel panel={pair.whyNotBuy} /> : null}

          {analysis?.zone ? (
            <View style={common.card}>
              <Text style={common.cardTitle}>Entry zone — not a single price</Text>
              <Text style={common.cardBody}>
                {analysis.zone.low.toFixed(digits)} – {analysis.zone.high.toFixed(digits)} · width{' '}
                {analysis.zone.widthPips.toFixed(1)} pips
              </Text>
              <Text style={common.cardBody}>
                Bid {pair.quote.bid} · Ask {pair.quote.ask}
                {analysis.stopLoss != null ? ` · SL ${analysis.stopLoss}` : ''}
                {analysis.takeProfit1 != null ? ` · TP1 ${analysis.takeProfit1}` : ''}
                {analysis.takeProfit2 != null ? ` · TP2 ${analysis.takeProfit2}` : ''}
              </Text>
            </View>
          ) : null}

          {analysis?.confidence ? (
            <View style={common.card}>
              <Text style={common.cardTitle}>Confidence is not probability</Text>
              <Text style={common.cardBody}>{analysis.confidence.warning}</Text>
              <Text style={[common.cardBody, { marginTop: 6 }]}>{analysis.confidence.sampleNote}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.sm }}>
            <Pressable
              style={[
                common.primaryBtn,
                {
                  flex: 1,
                  opacity: buyActive ? 1 : 0.4,
                  borderWidth: side === 'BUY' ? 2 : 0,
                  borderColor: colors.accent,
                },
              ]}
              disabled={!buyActive || busy}
              onPress={() => setSide('BUY')}
            >
              <Text style={common.primaryBtnText}>
                {side === 'BUY' ? `BUY ${analysis?.buyPct ?? '—'}% · selected` : `BUY ${analysis?.buyPct ?? '—'}%`}
              </Text>
            </Pressable>
            <Pressable
              style={[
                common.secondaryBtn,
                {
                  flex: 1,
                  borderColor: colors.danger,
                  opacity: sellActive ? 1 : 0.4,
                  borderWidth: side === 'SELL' ? 2 : 1,
                },
              ]}
              disabled={!sellActive || busy}
              onPress={() => setSide('SELL')}
            >
              <Text style={[common.secondaryBtnText, { color: colors.danger }]}>
                {side === 'SELL'
                  ? `SELL ${analysis?.sellPct ?? '—'}% · selected`
                  : `SELL ${analysis?.sellPct ?? '—'}%`}
              </Text>
            </Pressable>
          </View>

          {side || buyActive || sellActive ? (
            <View style={common.card}>
              <Text style={common.cardTitle}>Demo recheck</Text>
              <Text style={common.cardBody}>
                {rechecking
                  ? `Rechecking live ${demoSide ?? 'setup'}…`
                  : note || `Tap Demo trade after a ${demoSide ?? 'BUY/SELL'} recheck.`}
              </Text>
              {killSwitch ? (
                <Text style={[common.cardBody, { color: colors.muted, marginTop: 6 }]}>
                  Kill switch is ON (live broker blocked). Demo trades still fill.
                </Text>
              ) : null}
              {!signalId ? (
                <Text style={[common.cardBody, { color: colors.warn, marginTop: 6 }]}>
                  No fillable setup for this pair yet. Read the candles and why-not-buy panel — do not force a trade.
                </Text>
              ) : null}
              {pair.quote.dataQuality === 'DEGRADED' && ok ? (
                <Text style={[common.cardBody, { color: colors.warn, marginTop: 6 }]}>
                  Yahoo feed is delayed — demo is allowed. Live broker fills still need a tick.
                </Text>
              ) : null}
              {blockers.map((b) => (
                <Text key={b} style={[common.cardBody, { color: colors.warn, marginTop: 4 }]}>
                  {b}
                </Text>
              ))}
              {fillMsg ? (
                <Text style={[common.cardBody, { color: colors.positive, marginTop: 8, fontWeight: '700' }]}>
                  {fillMsg}
                </Text>
              ) : null}
              <View style={[common.row, { marginTop: 8 }]}>
                <StatusBadge
                  label={rechecking ? 'RECHECKING' : ok ? 'RECHECK PASS' : 'RECHECK FAIL'}
                  tone={rechecking ? 'info' : ok ? 'ok' : 'danger'}
                />
              </View>
            </View>
          ) : (
            <Text style={[common.cardBody, { marginBottom: spacing.sm }]}>
              Pick BUY or SELL only if the candles and why-not-buy panel agree. Wait is a valid answer.
            </Text>
          )}

          <Pressable
            style={[common.primaryBtn, { opacity: busy ? 0.7 : canFill || buyActive || sellActive ? 1 : 0.45 }]}
            disabled={busy}
            onPress={() => void confirm()}
          >
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <ActivityIndicator color="#04140E" size="small" />
                <Text style={common.primaryBtnText}>Opening demo {demoSide ?? 'trade'}…</Text>
              </View>
            ) : (
              <Text style={common.primaryBtnText}>
                Demo trade{demoSide ? ` ${demoSide}` : ''}
              </Text>
            )}
          </Pressable>
        </>
      ) : null}
      {error ? (
        <View style={[common.card, { marginTop: spacing.md }]}>
          <StatusBadge label="BLOCKED" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
