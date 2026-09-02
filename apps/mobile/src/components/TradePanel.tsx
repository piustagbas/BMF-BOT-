import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  fetchSwapQuote,
  fetchSwapTrade,
  prepareSwap,
  rejectSwap,
  submitSwap,
  type SwapQuote,
  type SwapTrade,
} from '../api/client';
import { useWallet } from '../wallet/WalletContext';
import { StatusBadge } from './StatusBadge';
import { colors, common, formatUsd, spacing } from '../theme';

const PCTS = [10, 25, 50, 75, 100];
const STATUSES = ['PREPARING', 'AWAITING_WALLET', 'SUBMITTED', 'PENDING', 'CONFIRMED'] as const;

type Props = {
  visible: boolean;
  side: 'BUY' | 'SELL';
  tokenAddress: string;
  symbol: string;
  priceUsd: number | null;
  onClose: () => void;
  onFilled?: () => void;
  initialSell?: boolean;
};

function statusTone(s: string): 'ok' | 'warn' | 'danger' | 'info' {
  if (s === 'CONFIRMED') return 'ok';
  if (s === 'FAILED' || s === 'REJECTED') return 'danger';
  if (s === 'PENDING' || s === 'SUBMITTED') return 'warn';
  return 'info';
}

export function TradePanel({
  visible,
  side,
  tokenAddress,
  symbol,
  priceUsd,
  onClose,
  onFilled,
}: Props) {
  const wallet = useWallet();
  const [step, setStep] = useState<'configure' | 'review' | 'status'>('configure');
  const [amount, setAmount] = useState('100');
  const [slippage, setSlippage] = useState('0.5');
  const [tp, setTp] = useState('50');
  const [sl, setSl] = useState('15');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [trade, setTrade] = useState<SwapTrade | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const idem = useRef(`swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    if (visible) {
      setStep('configure');
      setQuote(null);
      setTrade(null);
      setError(null);
      idem.current = `swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      void wallet.refresh();
    }
  }, [visible, side, tokenAddress, wallet]);

  useEffect(() => {
    if (!trade || !['SUBMITTED', 'PENDING'].includes(trade.status)) return;
    const id = setInterval(() => {
      void fetchSwapTrade(trade.id)
        .then((t) => {
          setTrade(t);
          if (t.status === 'CONFIRMED') onFilled?.();
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(id);
  }, [trade, onFilled]);

  const loadQuote = useCallback(
    async (pct?: number) => {
      if (!wallet.connected) {
        setError('Connect a wallet before trading.');
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const slippageBps = Math.round(Number(slippage || '0.5') * 100);
        const q = await fetchSwapQuote({
          side,
          tokenAddress,
          percent: pct,
          amountUsd: pct == null && side === 'BUY' ? Number(amount) : undefined,
          amountToken: pct == null && side === 'SELL' ? Number(amount) : undefined,
          slippageBps: Number.isFinite(slippageBps) ? slippageBps : 50,
          wallet: wallet.address ?? undefined,
        });
        setQuote(q);
        if (pct != null) {
          setAmount(side === 'BUY' ? String(q.amountUsd.toFixed(2)) : String(q.amountToken));
        }
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Quote failed');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [amount, side, slippage, tokenAddress, wallet.address, wallet.connected],
  );

  const review = async () => {
    const ok = await loadQuote();
    if (ok) setStep('review');
  };

  const confirm = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setStep('status');
    let preparedId: string | null = null;
    try {
      const slippageBps = Math.round(Number(slippage || '0.5') * 100);
      const prepared = await prepareSwap({
        side,
        tokenAddress,
        amountUsd: side === 'BUY' ? Number(amount) : undefined,
        amountToken: side === 'SELL' ? Number(amount) : undefined,
        slippageBps,
        wallet: wallet.address ?? undefined,
        takeProfitPct: side === 'BUY' && tp ? Number(tp) : null,
        stopLossPct: side === 'BUY' && sl ? Number(sl) : null,
        idempotencyKey: idem.current,
        confirmRealMoney: true,
      });
      preparedId = prepared.id;
      setTrade({
        id: prepared.id,
        status: 'AWAITING_WALLET',
        side,
        tokenAddress,
        symbol,
        name: symbol,
        wallet: wallet.address ?? '',
        amountUsd: prepared.quote.amountUsd,
        tokenQuantity: prepared.quote.estimatedReceived,
        entryPrice: prepared.quote.currentPrice,
        exitPrice: null,
        platformFeeUsd: prepared.quote.platformFeeUsd,
        networkFeeUsd: prepared.quote.networkFeeUsd,
        slippageBps: prepared.quote.slippageBps,
        priceImpactPct: prepared.quote.priceImpactPct,
        txSignature: null,
        errorMessage: null,
        takeProfitPct: prepared.takeProfitPct,
        stopLossPct: prepared.stopLossPct,
        confirmed: false,
      });
      const sig = await wallet.signAndSend(prepared.unsignedSwapTx);
      const submitted = await submitSwap(prepared.id, sig);
      setTrade(submitted);
      if (submitted.status === 'CONFIRMED') onFilled?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Trade failed';
      setError(msg);
      if (preparedId) {
        await rejectSwap(preparedId, msg).catch(() => undefined);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  if (!visible) return null;

  const q = quote;
  const title = side === 'BUY' ? `BUY $${symbol}` : `SELL $${symbol}`;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            maxHeight: '92%',
            paddingBottom: 28,
          }}
        >
          <View style={[common.row, { padding: spacing.md }]}>
            <Text style={common.title}>{title}</Text>
            <Pressable onPress={onClose}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 24 }}>
            {!wallet.connected ? (
              <View style={common.card}>
                <Text style={common.cardTitle}>Connect wallet</Text>
                <Text style={common.cardBody}>
                  Phantom or Solflare signs the swap on your device. This app never asks for a seed
                  phrase or private key.
                </Text>
                <View style={{ gap: 8, marginTop: 12 }}>
                  <Pressable
                    style={common.primaryBtn}
                    onPress={() =>
                      void wallet.connect('phantom').catch((e) =>
                        Alert.alert('Wallet', e instanceof Error ? e.message : 'Connect failed'),
                      )
                    }
                    disabled={wallet.connecting}
                  >
                    <Text style={common.primaryBtnText}>
                      {wallet.connecting ? 'Connecting…' : 'Connect Phantom'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={common.secondaryBtn}
                    onPress={() =>
                      void wallet.connect('solflare').catch((e) =>
                        Alert.alert('Wallet', e instanceof Error ? e.message : 'Connect failed'),
                      )
                    }
                    disabled={wallet.connecting}
                  >
                    <Text style={common.secondaryBtnText}>Connect Solflare</Text>
                  </Pressable>
                  <Pressable
                    style={common.secondaryBtn}
                    onPress={() => {
                      const prompt = Alert.prompt;
                      if (typeof prompt === 'function') {
                        prompt(
                          'Wallet address',
                          'Public Solana address only (cannot sign trades).',
                          (text) => {
                            if (text) void wallet.connect('manual', text);
                          },
                        );
                        return;
                      }
                      Alert.alert(
                        'Manual address',
                        'Use Phantom/Solflare to connect and sign. Pasting an address is supported on iOS.',
                      );
                    }}
                  >
                    <Text style={common.secondaryBtnText}>Paste public address</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={[common.card, { borderColor: colors.accent, borderWidth: 1 }]}>
                <StatusBadge label="CONNECTED" tone="ok" />
                <Text style={[common.cardTitle, { marginTop: 8 }]}>
                  {wallet.provider === 'solflare'
                    ? 'Solflare'
                    : wallet.provider === 'phantom'
                      ? 'Phantom'
                      : 'Wallet'}{' '}
                  connected successfully
                </Text>
                <Text style={common.cardBody}>
                  {wallet.address?.slice(0, 4)}…{wallet.address?.slice(-4)} · SOL{' '}
                  {wallet.solBalance.toFixed(4)} ({formatUsd(wallet.solBalanceUsd)})
                </Text>
                <Text style={[common.cardBody, { marginTop: 6 }]}>
                  Seed phrase was never requested. You can review this {side === 'BUY' ? 'buy' : 'sell'} now.
                </Text>
                <Pressable onPress={() => void wallet.disconnect()} style={{ marginTop: 8 }}>
                  <Text style={{ color: colors.danger, fontWeight: '700' }}>Disconnect</Text>
                </Pressable>
              </View>
            )}

            {error ? (
              <View style={common.card}>
                <StatusBadge label="TRADE ERROR" tone="danger" />
                <Text style={common.cardBody}>{error}</Text>
              </View>
            ) : null}

            {step === 'status' && trade ? (
              <View style={common.card}>
                <StatusBadge label={trade.status} tone={statusTone(trade.status)} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {STATUSES.map((s) => (
                    <StatusBadge
                      key={s}
                      label={s.replace('_', ' ')}
                      tone={
                        trade.status === s
                          ? statusTone(s)
                          : STATUSES.indexOf(s) <
                              STATUSES.indexOf(trade.status as (typeof STATUSES)[number])
                            ? 'ok'
                            : 'info'
                      }
                    />
                  ))}
                </View>
                <Text style={[common.cardBody, { marginTop: 10 }]}>
                  {trade.confirmed
                    ? 'Confirmed on-chain. Portfolio updated.'
                    : trade.status === 'FAILED' || trade.status === 'REJECTED'
                      ? trade.errorMessage ?? 'Not confirmed.'
                      : 'Waiting for blockchain confirmation. This is not a successful trade yet.'}
                </Text>
                {trade.txSignature ? (
                  <Text style={[common.cardBody, { marginTop: 8 }]} selectable>
                    {trade.txSignature}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {step !== 'status' ? (
              <>
                <View style={common.card}>
                  <Text style={common.cardTitle}>Amount</Text>
                  <Text style={common.cardBody}>
                    {side === 'BUY' ? 'USD to spend' : `$${symbol} to sell`} · price{' '}
                    {formatUsd(priceUsd)}
                  </Text>
                  <TextInput
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    style={input}
                  />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    {PCTS.map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => void loadQuote(p)}
                        style={[
                          common.secondaryBtn,
                          { paddingVertical: 8, paddingHorizontal: 12 },
                        ]}
                      >
                        <Text style={common.secondaryBtnText}>{p}%</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={[common.cardBody, { marginTop: 10 }]}>Slippage %</Text>
                  <TextInput
                    value={slippage}
                    onChangeText={setSlippage}
                    keyboardType="decimal-pad"
                    style={input}
                  />
                  {side === 'BUY' ? (
                    <>
                      <Text style={[common.cardBody, { marginTop: 10 }]}>
                        Take profit % (alert only)
                      </Text>
                      <TextInput value={tp} onChangeText={setTp} keyboardType="decimal-pad" style={input} />
                      <Text style={[common.cardBody, { marginTop: 10 }]}>
                        Stop loss % (alert only)
                      </Text>
                      <TextInput value={sl} onChangeText={setSl} keyboardType="decimal-pad" style={input} />
                    </>
                  ) : null}
                </View>

                {q ? (
                  <View style={common.card}>
                    <Text style={common.cardTitle}>
                      {step === 'review' ? (side === 'BUY' ? 'Review buy' : 'Review sell') : 'Quote'}
                    </Text>
                    <Row label="Token" value={`$${q.symbol}`} />
                    <Row label="Price" value={formatUsd(q.currentPrice)} />
                    <Row
                      label={side === 'BUY' ? 'Amount' : 'Selling'}
                      value={
                        side === 'BUY' ? formatUsd(q.amountUsd) : `${q.amountToken.toPrecision(4)} ${q.symbol}`
                      }
                    />
                    <Row label="Slippage" value={`${(q.slippageBps / 100).toFixed(2)}%`} />
                    <Row label="Network gas" value={formatUsd(q.networkFeeUsd)} />
                    <Row
                      label={`App fee ${((q.platformFeeBps ?? 50) / 100).toFixed(2)}% (not gas)`}
                      value={formatUsd(q.platformFeeUsd)}
                    />
                    <Row
                      label={side === 'BUY' ? 'Estimated received' : 'Estimated proceeds'}
                      value={
                        side === 'BUY'
                          ? `${q.estimatedReceived.toPrecision(6)} ${q.symbol}`
                          : formatUsd(q.estimatedProceedsUsd ?? q.amountUsd)
                      }
                    />
                    <Row
                      label="Price impact"
                      value={q.priceImpactPct != null ? `${q.priceImpactPct.toFixed(2)}%` : '—'}
                    />
                    <Row label="Minimum received" value={String(q.minimumReceived.toPrecision(6))} />
                    <Row label="Total (amount + gas)" value={formatUsd(q.totalUsd)} />
                    <Text style={[common.cardBody, { marginTop: 8 }]}>{q.platformFeeNote}</Text>
                    <Text style={[common.cardBody, { marginTop: 6 }]}>
                      Router {q.router} · {q.network} · {q.tradingPair}
                    </Text>
                  </View>
                ) : null}

                {busy ? <ActivityIndicator color={colors.accent} /> : null}

                {step === 'configure' ? (
                  <Pressable
                    style={[common.primaryBtn, { opacity: busy ? 0.6 : 1 }]}
                    disabled={busy || !wallet.connected}
                    onPress={() => void review()}
                  >
                    <Text style={common.primaryBtnText}>
                      {side === 'BUY' ? 'REVIEW BUY' : 'REVIEW SELL'}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[common.primaryBtn, { opacity: busy || submitting.current ? 0.6 : 1 }]}
                    disabled={busy || submitting.current}
                    onPress={() => void confirm()}
                  >
                    <Text style={common.primaryBtnText}>
                      {side === 'BUY' ? 'CONFIRM BUY' : 'CONFIRM SELL'}
                    </Text>
                  </Pressable>
                )}
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={[common.row, { marginTop: 6 }]}>
      <Text style={common.cardBody}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{value}</Text>
    </View>
  );
}

const input = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: colors.text,
  backgroundColor: colors.bgElevated,
  marginTop: 6,
} as const;
