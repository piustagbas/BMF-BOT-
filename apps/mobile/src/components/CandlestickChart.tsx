import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { colors, common, spacing } from '../theme';

export type ChartCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type ChartLevels = {
  entryMin?: number;
  entryMax?: number;
  stopLoss?: number;
};

type Props = {
  candles: ChartCandle[];
  timeframe: string;
  loading?: boolean;
  error?: string | null;
  onSelectTimeframe?: (tf: string) => void;
  timeframes?: string[];
  levels?: ChartLevels | null;
  height?: number;
  livePrice?: number | null;
};

const DEFAULT_TFS = ['1m', '5m', '15m', '30m', '1h', '4h'];
const MIN_BAR_WIDTH = 10;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.4;

export function clampChartZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1) return n.toPrecision(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(4);
}

function formatTime(unixSec: number, tf: string): string {
  const d = new Date(unixSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (tf === '1h' || tf === '4h') {
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

function pinchDistance(touches: ReadonlyArray<{ pageX: number; pageY: number }>): number {
  if (touches.length < 2) return 0;
  const a = touches[0]!;
  const b = touches[1]!;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export function CandlestickChart({
  candles,
  timeframe,
  loading,
  error,
  onSelectTimeframe,
  timeframes = DEFAULT_TFS,
  levels,
  height = 240,
  livePrice,
}: Props) {
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isPinching, setIsPinching] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const zoomRef = useRef(1);
  const pinchStartZoom = useRef(1);
  const pinchStartDist = useRef(0);

  zoomRef.current = zoom;

  const visible = candles;

  const { min, max, last, changePct } = useMemo(() => {
    if (!visible.length) {
      return { min: 0, max: 1, last: null as ChartCandle | null, changePct: 0 };
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of visible) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    if (levels?.entryMin != null) lo = Math.min(lo, levels.entryMin);
    if (levels?.entryMax != null) hi = Math.max(hi, levels.entryMax);
    if (levels?.stopLoss != null) lo = Math.min(lo, levels.stopLoss);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
      lo = visible[0]!.low;
      hi = visible[0]!.high || lo + 1;
    }
    const pad = (hi - lo) * 0.06 || hi * 0.01 || 1e-12;
    const first = visible[0]!;
    const end = visible[visible.length - 1]!;
    const pct = first.open > 0 ? ((end.close - first.open) / first.open) * 100 : 0;
    return { min: lo - pad, max: hi + pad, last: end, changePct: pct };
  }, [visible, levels]);

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  };

  const range = max - min || 1;
  const y = (price: number) => ((max - price) / range) * height;
  const barGap = Math.max(1, 2 * Math.min(zoom, 2));
  const barW = MIN_BAR_WIDTH * zoom;
  const contentWidth = Math.max(
    width,
    visible.length * barW + barGap * Math.max(0, visible.length - 1),
  );

  const applyZoom = (next: number) => {
    setZoom(clampChartZoom(next));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length >= 2,
      onStartShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length >= 2,
      onPanResponderGrant: (e) => {
        const dist = pinchDistance(e.nativeEvent.touches);
        pinchStartDist.current = dist;
        pinchStartZoom.current = zoomRef.current;
        setIsPinching(true);
      },
      onPanResponderMove: (e) => {
        const dist = pinchDistance(e.nativeEvent.touches);
        if (dist < 8 || pinchStartDist.current < 8) {
          if (dist >= 8) pinchStartDist.current = dist;
          return;
        }
        applyZoom(pinchStartZoom.current * (dist / pinchStartDist.current));
      },
      onPanResponderRelease: () => {
        pinchStartDist.current = 0;
        setIsPinching(false);
      },
      onPanResponderTerminate: () => {
        pinchStartDist.current = 0;
        setIsPinching(false);
      },
    }),
  ).current;

  useEffect(() => {
    setZoom(1);
  }, [timeframe]);

  useEffect(() => {
    if (!visible.length || width <= 0) return;
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [visible.length, timeframe, width]);

  const levelLines = useMemo(() => {
    const lines: Array<{ label: string; price: number; color: string }> = [];
    if (levels?.entryMin != null && levels?.entryMax != null) {
      const mid = (levels.entryMin + levels.entryMax) / 2;
      lines.push({ label: 'Entry', price: mid, color: colors.info });
    } else if (levels?.entryMin != null) {
      lines.push({ label: 'Entry', price: levels.entryMin, color: colors.info });
    }
    if (levels?.stopLoss != null) {
      lines.push({ label: 'SL', price: levels.stopLoss, color: colors.danger });
    }
    return lines;
  }, [levels]);

  return (
    <View style={common.card}>
      <View style={common.row}>
        <Text style={common.cardTitle}>Candlestick</Text>
        {last ? (
          <Text
            style={{
              color: changePct >= 0 ? colors.positive : colors.negative,
              fontWeight: '700',
              fontSize: 13,
            }}
          >
            {changePct >= 0 ? '+' : ''}
            {changePct.toFixed(2)}% ·{' '}
            {formatPrice(livePrice && livePrice > 0 ? livePrice : last.close)}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          marginBottom: spacing.sm,
          marginTop: 4,
        }}
      >
        {onSelectTimeframe
          ? timeframes.map((tf) => {
              const active = tf === timeframe;
              return (
                <Pressable
                  key={tf}
                  onPress={() => onSelectTimeframe(tf)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: active ? colors.accent : colors.border,
                    backgroundColor: active ? colors.accentDim : colors.bgElevated,
                  }}
                >
                  <Text
                    style={{
                      color: active ? colors.text : colors.muted,
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  >
                    {tf}
                  </Text>
                </Pressable>
              );
            })
          : (
            <Text style={common.cardBody}>{timeframe} chart</Text>
          )}
        <View style={{ flexDirection: 'row', gap: 6, marginLeft: 'auto' }}>
          <ZoomButton
            label="−"
            disabled={zoom <= MIN_ZOOM + 0.01}
            onPress={() => applyZoom(zoom / ZOOM_STEP)}
          />
          <ZoomButton
            label="+"
            disabled={zoom >= MAX_ZOOM - 0.01}
            onPress={() => applyZoom(zoom * ZOOM_STEP)}
          />
        </View>
      </View>

      <View
        onLayout={onLayout}
        {...panResponder.panHandlers}
        style={{
          height,
          width: '100%',
          backgroundColor: colors.bgElevated,
          borderRadius: 10,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        {loading && !visible.length ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error && !visible.length ? (
          <View style={{ flex: 1, padding: 12, justifyContent: 'center' }}>
            <Text style={common.cardBody}>{error}</Text>
          </View>
        ) : visible.length && width > 0 ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            nestedScrollEnabled
            scrollEnabled={!isPinching}
            showsHorizontalScrollIndicator
            bounces={false}
            contentContainerStyle={{ width: contentWidth, height }}
          >
            <View
              style={{
                width: contentWidth,
                height,
                position: 'relative',
                flexDirection: 'row',
              }}
            >
              {visible.map((c, i) => {
                const bull = c.close >= c.open;
                const color = bull ? colors.positive : colors.negative;
                const bodyTop = y(Math.max(c.open, c.close));
                const bodyBottom = y(Math.min(c.open, c.close));
                const bodyH = Math.max(1.5, bodyBottom - bodyTop);
                const wickTop = y(c.high);
                const wickBottom = y(c.low);
                const wickH = Math.max(1, wickBottom - wickTop);
                const wickW = zoom >= 1.6 ? 2 : 1.5;
                return (
                  <View
                    key={`${c.time}-${i}`}
                    style={{
                      width: barW,
                      marginRight: i === visible.length - 1 ? 0 : barGap,
                      height,
                      position: 'relative',
                    }}
                  >
                    <View
                      style={{
                        position: 'absolute',
                        left: barW / 2 - wickW / 2,
                        top: wickTop,
                        width: wickW,
                        height: wickH,
                        backgroundColor: color,
                        opacity: 0.85,
                      }}
                    />
                    <View
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: bodyTop,
                        width: barW,
                        height: bodyH,
                        backgroundColor: color,
                        borderRadius: 1,
                      }}
                    />
                  </View>
                );
              })}
              {levelLines.map((line) => {
                const top = y(line.price);
                if (top < 0 || top > height) return null;
                return (
                  <View
                    key={line.label}
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top,
                      borderTopWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: line.color,
                      opacity: 0.75,
                    }}
                  >
                    <Text
                      style={{
                        position: 'absolute',
                        right: 4,
                        top: -14,
                        color: line.color,
                        fontSize: 10,
                        fontWeight: '700',
                      }}
                    >
                      {line.label} {formatPrice(line.price)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={common.cardBody}>No candle data</Text>
          </View>
        )}
        {loading && visible.length ? (
          <View style={{ position: 'absolute', top: 8, right: 8 }}>
            <ActivityIndicator color={colors.accent} size="small" />
          </View>
        ) : null}
      </View>

      {visible.length >= 2 ? (
        <View style={[common.row, { marginTop: 8 }]}>
          <Text style={common.cardBody}>{formatTime(visible[0]!.time, timeframe)}</Text>
          <Text style={common.cardBody}>
            {formatTime(visible[visible.length - 1]!.time, timeframe)}
          </Text>
        </View>
      ) : null}
      {error && visible.length ? (
        <Text style={[common.cardBody, { marginTop: 6, color: colors.warn }]}>{error}</Text>
      ) : null}
      <Text style={[common.cardBody, { marginTop: 6 }]}>
        Pinch the chart or tap + / − to zoom. Swipe to move. Green = close above
        open.
      </Text>
    </View>
  );
}

function ZoomButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        minWidth: 36,
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: disabled ? colors.border : colors.accent,
        backgroundColor: colors.bgElevated,
        alignItems: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}
