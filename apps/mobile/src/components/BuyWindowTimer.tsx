import React, { useEffect, useRef, useState } from 'react';
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

function remainingSec(iso?: string, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((t - now) / 1000));
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function windowStateFromChart(
  chart: ChartGuideView,
  now = Date.now(),
): BuyWindowState {
  const toClose = remainingSec(chart.candleClosesAt, now);
  const toEnd = remainingSec(chart.entryWindowEndsAt, now);
  if (toClose != null && toClose > 0) return 'WAIT';
  if (toEnd != null && toEnd > 0) return 'ENTER';
  return 'CLOSED';
}

export function BuyWindowTimer({
  chart,
  signalType,
  compact = false,
  onExpire,
}: {
  chart: ChartGuideView;
  signalType: string;
  compact?: boolean;
  onExpire?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const isBuy = signalType === 'BUY';

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = windowStateFromChart(chart, now);
  const toClose = remainingSec(chart.candleClosesAt, now) ?? 0;
  const toEnd = remainingSec(chart.entryWindowEndsAt, now) ?? 0;
  const displaySec = state === 'WAIT' ? toClose : toEnd;

  const wasOpen = useRef(true);
  useEffect(() => {
    if (!isBuy || !onExpire) return;
    if (state === 'CLOSED' && wasOpen.current) {
      wasOpen.current = false;
      onExpire();
    }
    if (state !== 'CLOSED') wasOpen.current = true;
  }, [isBuy, state, onExpire]);

  const tone = state === 'WAIT' ? 'warn' : state === 'ENTER' ? 'ok' : 'danger';
  const label =
    state === 'WAIT'
      ? `WAIT ${formatClock(displaySec)}`
      : state === 'ENTER'
        ? `ENTER ${formatClock(displaySec)}`
        : 'WINDOW CLOSED';

  if (compact) {
    if (!isBuy) {
      return <StatusBadge label={`${chart.primary} → ${chart.confirm}`} tone="info" />;
    }
    return <StatusBadge label={label} tone={tone} />;
  }

  const headline =
    state === 'WAIT'
      ? `Wait ${formatClock(displaySec)} for the ${chart.primary} candle to close`
      : state === 'ENTER'
        ? `Entry window ${formatClock(displaySec)} left`
        : 'This timing window is over — refresh before you buy';

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
          fontSize: 22,
          fontWeight: '800',
          marginTop: 8,
          fontVariant: ['tabular-nums'],
        }}
      >
        {state === 'CLOSED' ? '0:00' : formatClock(displaySec)}
      </Text>
      <Text style={[common.cardBody, { marginTop: 4, color: colors.text }]}>{headline}</Text>
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
