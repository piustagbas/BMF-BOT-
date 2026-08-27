import React from 'react';
import { Text, View } from 'react-native';
import { StatusBadge } from '../components/StatusBadge';
import { common } from '../theme';

export function PlaceholderScreen({
  title,
  phase,
  body,
}: {
  title: string;
  phase: string;
  body: string;
}) {
  return (
    <View style={common.screen}>
      <Text style={common.title}>{title}</Text>
      <StatusBadge label={phase} tone="warn" />
      <Text style={common.subtitle}>{body}</Text>
      <View style={common.card}>
        <Text style={common.cardTitle}>Coming next</Text>
        <Text style={common.cardBody}>
          Phase 3 adds live DEX Screener / Jupiter / Solana data. Signal and paper engines follow
          after that. Real-money trading remains last.
        </Text>
      </View>
    </View>
  );
}
