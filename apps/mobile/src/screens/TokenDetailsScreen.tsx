import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import {
  addToWatchlist,
  fetchTokenDetail,
  fetchTokenOhlcv,
  fetchTokenSafety,
  fetchTokenSignal,
  fetchSwapPortfolio,
  openPaperFromSignal,
  proposeTrade,
  removeFromWatchlist,
  watchlistExists,
  type ScannerToken,
  type SignalItem,
  type TokenOhlcvCandle,
} from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { WhyNotBuyPanel, hardTestsPassed } from '../components/WhyNotBuyPanel';
import { BuyWindowTimer } from '../components/BuyWindowTimer';
import { CandlestickChart } from '../components/CandlestickChart';
import { DexScreenerBuyButton } from '../components/DexScreenerBuyButton';
import { TradePanel } from '../components/TradePanel';
import { TokenLogo } from '../components/TokenLogo';
import { CopyableAddress } from '../components/CopyableAddress';
import { useWallet } from '../wallet/WalletContext';
import { buildTokenSourceTags } from '../utils/sourceTags';
import { formatPairAgeHours } from '@memecoinbot/shared';
import {
  colors,
  common,
  formatPct,
  formatUsd,
  spacing,
} from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { useMemecoinAutoTrade } from '../settings/MemecoinAutoTradeContext';

type Props = NativeStackScreenProps<RootStackParamList, 'TokenDetails'>;

export function TokenDetailsScreen({ route, navigation }: Props) {
  const { address, action } = route.params;
  const wallet = useWallet();
  const [token, setToken] = useState<ScannerToken | null>(null);
  const [safety, setSafety] = useState<Awaited<ReturnType<typeof fetchTokenSafety>> | null>(
    null,
  );
  const [signal, setSignal] = useState<SignalItem | null>(null);
  const [watched, setWatched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [tradeSide, setTradeSide] = useState<'BUY' | 'SELL' | null>(action ?? null);
  const [heldQty, setHeldQty] = useState(0);
  const { addresses: autoTradeAddresses, toggle: toggleAutoTrade } =
    useMemecoinAutoTrade();
  const autoTrade = autoTradeAddresses.includes(address);
  const [chartTf, setChartTf] = useState('5m');
  const [candles, setCandles] = useState<TokenOhlcvCandle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const seededTf = useRef(false);
  const chartReq = useRef(0);
  const pairRef = useRef<string | null>(null);

  const loadChart = useCallback(
    async (tf: string, pair?: string | null) => {
      const req = ++chartReq.current;
      setChartLoading(true);
      const run = () =>
        fetchTokenOhlcv(address, {
          timeframe: tf,
          limit: 80,
          pairAddress: pair ?? pairRef.current,
        });
      try {
        let ohlcv;
        try {
          ohlcv = await run();
        } catch {
          await new Promise((r) => setTimeout(r, 1400));
          if (req !== chartReq.current) return;
          ohlcv = await run();
        }
        if (req !== chartReq.current) return;
        setCandles(ohlcv.candles);
        setChartError(null);
      } catch (e) {
        if (req !== chartReq.current) return;
        setChartError(e instanceof Error ? e.message : 'Chart unavailable');
      } finally {
        if (req === chartReq.current) setChartLoading(false);
      }
    },
    [address],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await fetchTokenDetail(address);
      setToken(t);
      pairRef.current = t.pairAddress ?? null;
      navigation.setOptions({
        title: t.symbol ? `$${t.symbol}` : 'Token',
      });

      const [s, sig, w, port] = await Promise.all([
        fetchTokenSafety(address).catch(() => null),
        fetchTokenSignal(address).catch(() => null),
        watchlistExists(address).catch(() => ({ watched: false })),
        fetchSwapPortfolio().catch(() => null),
      ]);
      setSafety(t.safety ?? s);
      setSignal(sig);
      setWatched(Boolean(w.watched));
      const held =
        port?.positions.find((p) => p.tokenAddress === address)?.qty ?? 0;
      setHeldQty(held);

      if (!seededTf.current) {
        seededTf.current = true;
        if (sig?.chart?.primary) {
          setChartTf(sig.chart.primary);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load token');
    } finally {
      setLoading(false);
    }
  }, [address, navigation]);

  const refreshAll = useCallback(async () => {
    await load();
    await loadChart(chartTf, pairRef.current);
  }, [load, loadChart, chartTf]);

  const refreshOnExpire = useCallback(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    seededTf.current = false;
    pairRef.current = null;
    setChartTf('5m');
    setCandles([]);
    setChartError(null);
  }, [address]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!token || token.address !== address) return;
    void loadChart(chartTf, token.pairAddress);
  }, [address, chartTf, loadChart, token?.address, token?.pairAddress]);

  useEffect(() => {
    if (!token || token.address !== address) return;
    const id = setInterval(() => {
      void loadChart(chartTf, token.pairAddress);
    }, 15000);
    return () => clearInterval(id);
  }, [address, chartTf, loadChart, token?.address, token?.pairAddress]);

  const displayCandles = useMemo(() => {
    if (!candles.length || token?.priceUsd == null) return candles;
    const last = candles[candles.length - 1]!;
    const tfSec =
      chartTf === '1m'
        ? 60
        : chartTf === '15m'
          ? 900
          : chartTf === '30m'
            ? 1800
            : chartTf === '1h'
              ? 3600
              : chartTf === '4h'
                ? 14400
                : 300;
    const now = Date.now() / 1000;
    if (last.time + tfSec < now) return candles;
    const price = token.priceUsd;
    return [
      ...candles.slice(0, -1),
      {
        ...last,
        close: price,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
      },
    ];
  }, [candles, token?.priceUsd, chartTf]);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    setActionMsg(null);
    setError(null);
    try {
      await fn();
      setActionMsg(okMsg);
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const buyActive = signal?.signalType === 'BUY';
  const testsPassed = Boolean(
    buyActive &&
      (signal?.whyNotBuy
        ? hardTestsPassed(signal.whyNotBuy)
        : !(signal?.failedChecks && signal.failedChecks.length)),
  );
  const sellLiqOk = (token?.liquidityUsd ?? 0) >= 10_000;
  const sellDataOk = !token?.dataConflict;
  const sellHeldOk = heldQty > 0;
  const sellWalletOk = wallet.connected;
  const sellPassed = sellWalletOk && sellLiqOk && sellDataOk && sellHeldOk;
  const sellReady = sellWalletOk && sellLiqOk && sellDataOk;
  const sellBlockers = [
    !sellWalletOk ? 'Connect Phantom or Solflare first' : null,
    !sellHeldOk ? 'No position recorded for this token in the app' : null,
    !sellLiqOk ? 'Liquidity is too thin to exit safely' : null,
    !sellDataOk ? 'Market data conflict — do not sell blindly' : null,
  ].filter(Boolean) as string[];

  const demoTrade = async () => {
    if (!testsPassed) {
      const msg =
        'Demo trade is blocked. BUY did not pass the hard tests. Do not buy — this is how you avoid a loss.';
      setError(msg);
      Alert.alert('Do not buy', msg);
      return;
    }
    setDemoBusy(true);
    setActionMsg(null);
    setError(null);
    try {
      const result = await openPaperFromSignal(address);
      const pos = result.position;
      const msg = pos
        ? `Demo $${pos.symbol} opened · $${Number(pos.sizeUsd).toFixed(2)} at ${pos.entryPrice}`
        : 'Demo trade opened';
      setActionMsg(msg);
      Alert.alert('Demo trade opened', `${msg}\nOpen More → Demo trading to watch TP/SL.`);
      await refreshAll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Demo trade failed';
      setError(msg);
      Alert.alert('Demo trade blocked', msg);
    } finally {
      setDemoBusy(false);
    }
  };

  if (loading && !token) {
    return (
      <View style={[common.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const change = token?.priceChange24h ?? 0;
  const mcap = token?.marketCap ?? token?.fdv ?? null;
  const sourceTags = token
    ? buildTokenSourceTags({
        marketSource: token.source,
        jupiterPriceUsd: token.jupiterPriceUsd,
        safetyScore: token.safetyScore ?? safety?.safetyScore ?? null,
      })
    : [];
  const safetyScore =
    token?.safetyScore ?? safety?.safetyScore ?? signal?.safetyScore ?? null;

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={
        <RefreshControl
          refreshing={loading || busy || chartLoading}
          onRefresh={refreshAll}
          tintColor={colors.accent}
        />
      }
    >
      {error ? (
        <View style={common.card}>
          <StatusBadge label="ERROR" tone="danger" />
          <Text style={common.cardBody}>{error}</Text>
        </View>
      ) : null}
      {actionMsg ? (
        <View style={common.card}>
          <StatusBadge label="OK" tone="ok" />
          <Text style={common.cardBody}>{actionMsg}</Text>
        </View>
      ) : null}

      <View style={common.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TokenLogo uri={token?.imageUrl} symbol={token?.symbol} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={common.title}>${token?.symbol ?? '—'}</Text>
            <Text style={common.subtitle}>{token?.name ?? 'Token'}</Text>
          </View>
        </View>
        <Text style={common.metric}>{formatUsd(token?.priceUsd)}</Text>
        <Text
          style={{
            color: change >= 0 ? colors.positive : colors.negative,
            fontWeight: '700',
            fontSize: 16,
            marginTop: 4,
          }}
        >
          {formatPct(token?.priceChange24h)} 24h
          {formatPairAgeHours(token?.pairAgeHours)
            ? ` · ${formatPairAgeHours(token?.pairAgeHours)}`
            : ''}
        </Text>
        <Text style={[common.cardBody, { marginTop: spacing.sm }]}>
          {token?.dexId ?? 'dex'}
        </Text>
        <CopyableAddress address={address} />
      </View>

      <CandlestickChart
        candles={displayCandles}
        timeframe={chartTf}
        loading={chartLoading}
        error={chartError}
        onSelectTimeframe={setChartTf}
        livePrice={token?.priceUsd ?? null}
        levels={
          signal?.levels
            ? {
                entryMin: signal.levels.entryMin,
                entryMax: signal.levels.entryMax,
                stopLoss: signal.levels.stopLoss,
              }
            : null
        }
      />

      <View style={common.card}>
        <Text style={common.cardTitle}>Market</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
          <Metric label="Liquidity" value={formatUsd(token?.liquidityUsd)} />
          <Metric label="Volume 24h" value={formatUsd(token?.volume24h)} />
          <Metric label="MCap" value={formatUsd(mcap)} />
          <Metric
            label="Buys/Sells"
            value={`${token?.buys24h ?? '—'} / ${token?.sells24h ?? '—'}`}
          />
          <Metric label="Network" value="Solana" />
          <Metric label="Pair" value={token?.pairAddress ? `${token.dexId ?? 'DEX'}` : '—'} />
          <Metric label="Router" value="Jupiter" />
        </View>
        {sourceTags.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {sourceTags.map((tag) => (
              <StatusBadge key={tag} label={tag} tone="info" />
            ))}
          </View>
        ) : null}
        {token?.dataConflict ? (
          <View style={{ marginTop: 6 }}>
            <StatusBadge label="DATA CONFLICT" tone="danger" />
            <Text style={common.cardBody}>{token.conflictReason}</Text>
          </View>
        ) : null}
      </View>

      {safety || safetyScore != null ? (
        <View style={common.card}>
          <View style={common.row}>
            <Text style={common.cardTitle}>Safety</Text>
            <StatusBadge
              label={`${Math.round(safetyScore ?? 0)}/100`}
              tone={
                safety?.criticalWarning
                  ? 'danger'
                  : (safetyScore ?? 0) >= 80
                    ? 'ok'
                    : 'warn'
              }
            />
          </View>
          {safety ? (
            <>
              <StatusBadge
                label={safety.decision}
                tone={safety.decision === 'NO_TRADE' ? 'danger' : 'ok'}
              />
              <Text style={common.cardBody}>{safety.summary}</Text>
              <Text style={[common.cardBody, { marginTop: 8 }]}>
                Holders {safety.holderRisk} · Whale {safety.whaleActivity}
              </Text>
              <Text style={common.cardBody}>
                Mint revoked: {String(safety.mintAuthorityRevoked)} · Freeze revoked:{' '}
                {String(safety.freezeAuthorityRevoked)}
              </Text>
              {safety.beginner?.decision ? (
                <Text style={[common.cardBody, { marginTop: 8, color: colors.text }]}>
                  {safety.beginner.decision}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      {signal ? (
        <View style={common.card}>
          <View style={common.row}>
            <Text style={common.cardTitle}>Signal</Text>
            <StatusBadge
              label={testsPassed ? signal.signalType : signal.signalType === 'BUY' ? 'BUY BLOCKED' : signal.signalType}
              tone={
                testsPassed
                  ? 'ok'
                  : signal.signalType === 'NO_TRADE' || signal.signalType === 'BUY'
                    ? 'danger'
                    : 'warn'
              }
            />
          </View>
          <Text style={common.cardBody}>
            Safety {Math.round(signal.safetyScore)}/100 (same score as above)
          </Text>
          <Text style={common.cardBody}>
            Buy score {Math.round(signal.buyScore ?? signal.signalScore)}/100
            {signal.strategy ? ` · ${signal.strategy.name}` : ''}
          </Text>
          <View style={[common.row, { marginTop: 10 }]}>
            <Text style={[common.cardBody, { flex: 1 }]}>
              Auto-trade this coin when BUY passes
            </Text>
            <Switch
              value={autoTrade}
              onValueChange={(v) => void toggleAutoTrade(address, v).catch(() => undefined)}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>
          <Text style={[common.cardBody, { marginTop: 4, color: colors.muted, fontSize: 11 }]}>
            {autoTrade
              ? testsPassed
                ? 'Auto is ON for this coin and tests passed — demo fill runs with the Telegram BUY.'
                : 'Auto is ON for this coin. BUY stays locked until every hard test passes.'
              : 'Turn this on to fill only this coin when its BUY passes every hard test.'}
          </Text>
          {signal.independent ? (
            <Text style={common.cardBody}>
              Independent signals {signal.independent.agreeing}/{signal.independent.required} agree
            </Text>
          ) : null}
          {signal.memeScore ? (
            <View style={{ marginTop: 8 }}>
              <Text style={common.cardBody}>
                Meme score {Math.round(signal.memeScore.overall)}/100 · {signal.memeScore.level}
                {signal.memeScore.independentWallets
                  ? ` · ${signal.memeScore.independentWallets} independent wallets (${signal.memeScore.tierA} A / ${signal.memeScore.tierB} B)`
                  : ''}
              </Text>
              <Text style={[common.cardBody, { marginTop: 4 }]}>
                {signal.memeScore.reason}
              </Text>
            </View>
          ) : null}
          {signal.chart ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              <StatusBadge label={`CHART ${signal.chart.primary}`} tone="info" />
              <StatusBadge label={`CONF ${signal.chart.confirm}`} tone="info" />
              <StatusBadge label={signal.chart.style} tone="warn" />
            </View>
          ) : null}
          {signal.chart ? (
            <BuyWindowTimer
              chart={signal.chart}
              signalType={signal.signalType}
              testsPassed={testsPassed}
              onExpire={refreshOnExpire}
            />
          ) : (
            <BuyWindowTimer
              chart={{ primary: chartTf, confirm: '15m', style: 'SCALP' }}
              signalType={signal.signalType}
              testsPassed={testsPassed}
              onExpire={refreshOnExpire}
            />
          )}
          <Text style={[common.cardBody, { marginTop: 8 }]}>
            Entry {signal.levels.entryMin.toPrecision(4)}–
            {signal.levels.entryMax.toPrecision(4)}
          </Text>
          <Text style={common.cardBody}>
            SL {signal.levels.stopLoss.toPrecision(4)} · TP1 +{signal.levels.tp1Pct}% ·
            TP2 +{signal.levels.tp2Pct}% · R:R {signal.levels.riskReward.toFixed(2)}
          </Text>
          <Text style={[common.cardBody, { marginTop: 8, color: colors.text }]}>
            {signal.beginner?.decision}
          </Text>
        </View>
      ) : null}

      {signal?.whyNotBuy ? <WhyNotBuyPanel panel={signal.whyNotBuy} /> : null}

      <View style={common.card}>
        <View style={common.row}>
          <Text style={common.cardTitle}>Why not sell</Text>
          <StatusBadge label={sellPassed ? 'SELL OK' : 'DO NOT SELL'} tone={sellPassed ? 'ok' : 'danger'} />
        </View>
        <Text style={[common.cardBody, { marginTop: 4, color: sellPassed ? colors.text : colors.danger }]}>
          {sellPassed
            ? `You hold this token (${heldQty}). Liquidity and data checks passed. Still not guaranteed.`
            : sellBlockers.join(' · ') || 'Sell tests did not pass.'}
        </Text>
        <Text style={[common.cardBody, { marginTop: 8 }]}>
          Wallet {sellWalletOk ? 'PASS' : 'FAIL'} · Position {sellHeldOk ? 'PASS' : 'FAIL'} · Liquidity{' '}
          {sellLiqOk ? 'PASS' : 'FAIL'} · Data {sellDataOk ? 'PASS' : 'FAIL'}
        </Text>
      </View>

      {signal && !signal.whyNotBuy && signal.failedChecks?.length ? (
        <View style={common.card}>
          <Text style={common.cardTitle}>Why Not Buy</Text>
          {signal.failedChecks.map((c) => (
            <Text key={c} style={[common.cardBody, { marginTop: 4, color: colors.warn }]}>
              {c}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={common.card}>
        <Text style={common.cardTitle}>Trade in-app</Text>
        <Text style={[common.cardBody, { marginBottom: spacing.sm }]}>
          {testsPassed
            ? 'Hard buy tests passed. Sell still needs its own checks (wallet, position, liquidity).'
            : 'BUY is locked until every hard test passes. SELL is locked until you hold the token and exit tests pass.'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            style={[common.primaryBtn, { flex: 1, opacity: testsPassed ? 1 : 0.4 }]}
            onPress={() => {
              if (!testsPassed) {
                Alert.alert(
                  'Do not buy',
                  'This coin did not pass the buy tests. The bot will not let you buy so you do not run a loss. Wait for Why This Passed.',
                );
                return;
              }
              setTradeSide('BUY');
            }}
          >
            <Text style={common.primaryBtnText}>
              {testsPassed ? 'BUY' : 'BUY (tests failed)'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              common.secondaryBtn,
              { flex: 1, borderColor: colors.danger, opacity: sellReady ? 1 : 0.4 },
            ]}
            onPress={() => {
              if (!sellWalletOk || !sellLiqOk || !sellDataOk) {
                Alert.alert(
                  'Do not sell yet',
                  sellBlockers.filter((b) => !b.includes('position')).join('\n') ||
                    'Sell tests did not pass.',
                );
                return;
              }
              if (!sellHeldOk) {
                Alert.alert(
                  'No recorded position',
                  'This app has no buy for this token. Continue only if this connected wallet holds it. On-chain balance, liquidity, and price impact are checked before fill.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Continue', onPress: () => setTradeSide('SELL') },
                  ],
                );
                return;
              }
              setTradeSide('SELL');
            }}
          >
            <Text style={[common.secondaryBtnText, { color: colors.danger }]}>
              {sellPassed ? 'SELL' : 'SELL (tests failed)'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={common.card}>
        <Text style={common.cardTitle}>Actions</Text>
        <Text style={[common.cardBody, { marginBottom: spacing.sm }]}>
          Potential setup tools only — never guaranteed. Demo first.
          {signal?.signalType === 'BUY'
            ? testsPassed
              ? ' DexScreener is optional if you still want the external chart.'
              : ' BUY is showing as a lean only — tests failed, so do not buy.'
            : ''}
        </Text>
        <View style={{ gap: 8 }}>
          {testsPassed ? (
            <DexScreenerBuyButton
              mint={address}
              pairAddress={token?.pairAddress ?? signal?.token.pairAddress}
            />
          ) : null}
          <Pressable
            style={signal?.signalType === 'BUY' ? common.secondaryBtn : common.primaryBtn}
            disabled={busy}
            onPress={() =>
              run(
                () =>
                  watched
                    ? removeFromWatchlist(address)
                    : addToWatchlist(address),
                watched ? 'Removed from watchlist' : 'Added to watchlist',
              )
            }
          >
            <Text
              style={
                signal?.signalType === 'BUY'
                  ? common.secondaryBtnText
                  : common.primaryBtnText
              }
            >
              {watched ? 'Remove from watchlist' : 'Add to watchlist'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              testsPassed ? common.primaryBtn : common.secondaryBtn,
              { opacity: demoBusy ? 0.7 : testsPassed ? 1 : 0.5 },
            ]}
            disabled={busy || demoBusy}
            onPress={() => void demoTrade()}
          >
            {demoBusy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <ActivityIndicator color="#04140E" size="small" />
                <Text style={common.primaryBtnText}>Opening demo trade…</Text>
              </View>
            ) : (
              <Text style={testsPassed ? common.primaryBtnText : common.secondaryBtnText}>
                {testsPassed ? 'Demo trade' : 'Demo trade (needs tests PASS)'}
              </Text>
            )}
          </Pressable>
          {actionMsg ? (
            <Text style={[common.cardBody, { color: colors.positive }]}>{actionMsg}</Text>
          ) : null}
          <Pressable
            style={common.secondaryBtn}
            disabled={busy}
            onPress={() =>
              run(() => proposeTrade(address), 'Real-trade proposal created (approve in Trade)')
            }
          >
            <Text style={common.secondaryBtnText}>Propose real trade</Text>
          </Pressable>
        </View>
      </View>

      <TradePanel
        visible={tradeSide != null}
        side={tradeSide ?? 'BUY'}
        tokenAddress={address}
        symbol={token?.symbol ?? 'TOKEN'}
        priceUsd={token?.priceUsd ?? null}
        onClose={() => setTradeSide(null)}
        onFilled={() => {
          setActionMsg('Trade confirmed on-chain. Check Portfolio for the new position.');
          void refreshAll();
        }}
      />
    </ScrollView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ minWidth: '40%' }}>
      <Text style={common.metricLabel}>{label}</Text>
      <Text style={[common.metric, { fontSize: 15 }]}>{value}</Text>
    </View>
  );
}
