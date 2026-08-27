import React from 'react';
import { Text, View } from 'react-native';
import { colors, common } from '../theme';

type Props = {
  label: string;
  tone?: 'ok' | 'warn' | 'danger' | 'info';
};

const toneBg = {
  ok: colors.accent,
  warn: colors.warn,
  danger: colors.danger,
  info: colors.info,
};

export function StatusBadge({ label, tone = 'info' }: Props) {
  return (
    <View style={[common.badge, { backgroundColor: toneBg[tone] + '22' }]}>
      <Text style={[common.badgeText, { color: toneBg[tone] }]}>{label}</Text>
    </View>
  );
}
