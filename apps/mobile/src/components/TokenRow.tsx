import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatPairAgeHours } from '@memecoinbot/shared';
import { colors, common, formatPct, formatUsd, spacing } from '../theme';
import { StatusBadge } from './StatusBadge';
import { TokenLogo } from './TokenLogo';
import { CopyableAddress } from './CopyableAddress';

type Props = {
  symbol: string;
  name?: string;
  address: string;
  imageUrl?: string | null;
  pairAgeHours?: number | null;
  priceUsd?: number | null;
  priceChange24h?: number | null;
  liquidityUsd?: number | null;
  volume24h?: number | null;
  safetyScore?: number | null;
  signalType?: string | null;
  criticalWarning?: boolean;
  /** Short provider codes e.g. DEX, GEK, JUP, SEC */
  sourceTags?: string[];
  whyLine?: string | null;
  onPress?: () => void;
};

const SIGNAL_LABEL: Record<string, string> = {
  BUY: 'BUY',
  WATCH: 'WATCH',
  SETUP_FORMING: 'SETUP FORMING',
  NO_TRADE: 'NO TRADE',
};

export function TokenRow({
  symbol,
  name,
  address,
  imageUrl,
  pairAgeHours,
  priceUsd,
  priceChange24h,
  liquidityUsd,
  volume24h,
  safetyScore,
  signalType,
  criticalWarning,
  sourceTags,
  whyLine,
  onPress,
}: Props) {
  const change = priceChange24h ?? 0;
  const ageLabel = formatPairAgeHours(pairAgeHours);
  return (
    <View style={common.card}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        <View style={common.row}>
          <TokenLogo uri={imageUrl} symbol={symbol} size={44} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={common.cardTitle}>
              ${symbol}
              {name ? (
                <Text style={{ color: colors.muted, fontWeight: '500' }}> · {name}</Text>
              ) : null}
            </Text>
            {ageLabel ? (
              <Text style={[common.cardBody, { fontSize: 11 }]}>{ageLabel}</Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={common.metric}>{formatUsd(priceUsd)}</Text>
            <Text
              style={{
                color: change >= 0 ? colors.positive : colors.negative,
                fontWeight: '700',
                fontSize: 13,
              }}
            >
              {formatPct(priceChange24h)}
            </Text>
          </View>
        </View>
      </Pressable>

      <CopyableAddress address={address} compact />

      <Text style={[common.cardBody, { marginTop: spacing.sm }]}>
        Liq {formatUsd(liquidityUsd)}
        {volume24h != null ? ` · Vol ${formatUsd(volume24h)}` : ''}
      </Text>

      {whyLine ? (
        <Text style={[common.cardBody, { marginTop: 8, color: colors.text }]}>
          {whyLine}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {(sourceTags ?? []).map((tag) => (
          <StatusBadge key={tag} label={tag} tone="info" />
        ))}
        {ageLabel ? <StatusBadge label={ageLabel.toUpperCase()} tone="warn" /> : null}
        {safetyScore != null ? (
          <StatusBadge
            label={`SAFE ${Math.round(safetyScore)}`}
            tone={
              criticalWarning
                ? 'danger'
                : safetyScore >= 80
                  ? 'ok'
                  : safetyScore >= 60
                    ? 'warn'
                    : 'danger'
            }
          />
        ) : null}
        {signalType ? (
          <StatusBadge
            label={SIGNAL_LABEL[signalType] ?? signalType.replace(/_/g, ' ')}
            tone={
              signalType === 'BUY'
                ? 'ok'
                : signalType === 'NO_TRADE'
                  ? 'danger'
                  : 'warn'
            }
          />
        ) : null}
      </View>
    </View>
  );
}
