import React from 'react';
import { Text, View } from 'react-native';
import { StatusBadge } from '../../components/StatusBadge';
import { colors } from '../../theme';

export function LiveScoreboard({
  home,
  away,
  score,
  minute,
}: {
  home: string;
  away: string;
  score?: { home: number | null; away: number | null };
  minute?: string;
}) {
  const hs = score?.home != null ? String(score.home) : '—';
  const as = score?.away != null ? String(score.away) : '—';
  const clock = minute ? String(minute).replace(/'+/g, '') : '';
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <StatusBadge label="LIVE" tone="danger" />
        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>
          {clock ? `${clock}'` : 'In play'}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15, lineHeight: 20 }} numberOfLines={2}>
            {home}
          </Text>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15, lineHeight: 20, marginTop: 4 }} numberOfLines={2}>
            {away}
          </Text>
        </View>
        <View style={{ minWidth: 52, alignItems: 'flex-end' }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, lineHeight: 22 }}>{hs}</Text>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, lineHeight: 22, marginTop: 2 }}>{as}</Text>
        </View>
      </View>
    </View>
  );
}
