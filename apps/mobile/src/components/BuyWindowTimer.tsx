import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { StatusBadge } from './StatusBadge';
import { colors, common, spacing } from '../theme';

export type ChartGuideView = {
  primary: string;
  confirm: string;
  style: 'SCALP' | 'MINUTES' | 'HOURS';
  reason?: string;
  meaning?: string;
  instruction?: string;
  candleClosesAt?: string;
  confirmClosesAt?: string;
  entryWindowEndsAt?: string;
  waitForClose?: boolean;
};

export type BuyWindowState = 'WAIT' | 'ENTER' | 'CLOSED';

const TF_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14_400,
};

function timeframeSec(tf?: string): number {
  return TF_SECONDS[tf ?? ''] ?? 300;
}

/** Always-live candle clock so the countdown never freezes on a stale signal timestamp. */
function liveCandleWindow(tf: string, nowMs = Date.now()) {
  const sec = timeframeSec(tf);
  const nowSec = Math.floor(nowMs / 1000);
  const startSec = nowSec - (nowSec % sec);
  const closeSec = startSec + sec;
  return {
    closeMs: closeSec * 1000,
    endMs: (closeSec + sec) * 1000,
    remainingClose: Math.max(0, closeSec - nowSec),
    remainingEnd: Math.max(0, closeSec + sec - nowSec),
  };
}

function parseMs(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function formatClock(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.max(0, sec) % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatLocal(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function windowStateFromChart(
  chart: ChartGuideView,
  now = Date.now(),
): BuyWindowState {
  const live = liveCandleWindow(chart.primary, now);
  const closeMs = parseMs(chart.candleClosesAt);
  const toClose =
    closeMs != null && closeMs > now
      ? Math.floor((closeMs - now) / 1000)
      : live.remainingClose;
  const endMs = parseMs(chart.entryWindowEndsAt);
  const toEnd =
    endMs != null && endMs > now ? Math.floor((endMs - now) / 1000) : live.remainingEnd;
  if (toClose > 0) return 'WAIT';
  if (toEnd > 0) return 'ENTER';
  return 'CLOSED';
}

export function BuyWindowTimer({
  chart,
  signalType,
  compact = false,
  testsPassed = true,
  onExpire,
}: {
  chart: ChartGuideView;
  signalType: string;
  compact?: boolean;
  testsPassed?: boolean;
  onExpire?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const isBuy = signalType === 'BUY';

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const live = useMemo(() => liveCandleWindow(chart.primary, now), [chart.primary, now]);
  const closeMs = parseMs(chart.candleClosesAt);
  const endMs = parseMs(chart.entryWindowEndsAt);
  const toClose =
    closeMs != null && closeMs > now
      ? Math.floor((closeMs - now) / 1000)
      : live.remainingClose;
  const toEnd =
    endMs != null && endMs > now ? Math.floor((endMs - now) / 1000) : live.remainingEnd;
  const state: BuyWindowState = toClose > 0 ? 'WAIT' : toEnd > 0 ? 'ENTER' : 'CLOSED';
  const displaySec = state === 'WAIT' ? toClose : toEnd;
  const closeAt = closeMs != null && closeMs > now ? closeMs : live.closeMs;
  const windowEnd = endMs != null && endMs > now ? endMs : live.endMs;

  const wasOpen = useRef(true);
  useEffect(() => {
    if (!onExpire) return;
    if (state === 'CLOSED' && wasOpen.current) {
      wasOpen.current = false;
      onExpire();
    }
    if (state !== 'CLOSED') wasOpen.current = true;
  }, [state, onExpire]);

  const tone = state === 'WAIT' ? 'warn' : state === 'ENTER' ? 'ok' : 'danger';
  const label =
    state === 'WAIT'
      ? `WAIT ${formatClock(displaySec)}`
      : state === 'ENTER'
        ? `ENTER ${formatClock(displaySec)}`
        : 'WINDOW CLOSED';

  if (compact) {
    return <StatusBadge label={label} tone={!testsPassed && isBuy ? 'warn' : tone} />;
  }

  const headline =
    state === 'WAIT'
      ? `Wait ${formatClock(displaySec)} — enter after ${formatLocal(closeAt)}`
      : state === 'ENTER'
        ? `Enter window ${formatClock(displaySec)} left · until ${formatLocal(windowEnd)}`
        : 'This candle window ended — the next one is already counting';

  return (
    <View
      style={{
        marginTop: spacing.sm,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor:
          state === 'WAIT' ? colors.warn : state === 'ENTER' ? colors.accent : colors.danger,
        backgroundColor: colors.bgElevated,
      }}
    >
      <View style={common.row}>
        <Text style={[common.cardTitle, { marginBottom: 0, fontSize: 15 }]}>
          {isBuy ? 'Buy timing' : 'Chart clock'}
        </Text>
        <StatusBadge label={label} tone={tone} />
      </View>
      <Text
        style={{
          color: colors.text,
          fontSize: 28,
          fontWeight: '800',
          marginTop: 8,
          fontVariant: ['tabular-nums'],
        }}
      >
        {formatClock(displaySec)}
      </Text>
      <Text style={[common.cardBody, { marginTop: 4, color: colors.text }]}>{headline}</Text>
      <Text style={[common.cardBody, { marginTop: 6 }]}>
        {chart.primary} candle closes {formatLocal(closeAt)} · window ends {formatLocal(windowEnd)}
      </Text>
      {!testsPassed ? (
        <Text style={[common.cardBody, { marginTop: 6, color: colors.danger, fontWeight: '700' }]}>
          Clock is running, but hard tests have not passed — do not buy.
        </Text>
      ) : null}
      {chart.instruction ? (
        <Text style={[common.cardBody, { marginTop: 6 }]}>{chart.instruction}</Text>
      ) : null}
      {chart.meaning ? (
        <Text style={[common.cardBody, { marginTop: 8 }]}>{chart.meaning}</Text>
      ) : null}
      {chart.reason ? (
        <Text style={[common.cardBody, { marginTop: 6, color: colors.info }]}>{chart.reason}</Text>
      ) : null}
    </View>
  );
}
