import React from 'react';
import { Text, View } from 'react-native';
import { StatusBadge } from './StatusBadge';
import { colors, common, spacing } from '../theme';

export type WhyNotBuyItemView = {
  key: string;
  label: string;
  passed: boolean;
  blocking: boolean;
  status: 'PASS' | 'FAIL' | 'NEUTRAL';
  value: string;
  detail: string;
  whyItMatters: string;
};

export type WhyNotBuyView = {
  title: string;
  decision: string;
  buyScore: number;
  safetyScore: number;
  agreeing: number;
  required: number;
  available: number;
  summary: string;
  items: WhyNotBuyItemView[];
};

export function WhyNotBuyPanel({ panel }: { panel: WhyNotBuyView }) {
  const blockingFails = panel.items.filter((i) => i.blocking && !i.passed);
  const signals = panel.items.filter((i) => i.key.startsWith('sig_'));
  const gates = panel.items.filter((i) => i.blocking);

  return (
    <View style={common.card}>
      <View style={common.row}>
        <Text style={common.cardTitle}>{panel.title}</Text>
        <StatusBadge
          label={panel.decision}
          tone={panel.decision === 'BUY' ? 'ok' : panel.decision === 'NO_TRADE' ? 'danger' : 'warn'}
        />
      </View>
      <Text style={[common.cardBody, { marginTop: 4, color: colors.text }]}>
        {panel.summary}
      </Text>
      <Text style={[common.cardBody, { marginTop: 8 }]}>
        Buy score {Math.round(panel.buyScore)} · Safety {Math.round(panel.safetyScore)} ·
        Independent {panel.agreeing}/{panel.required} agree ({panel.available} available)
      </Text>

      <Text style={[common.cardTitle, { marginTop: spacing.md, fontSize: 14 }]}>
        Hard gates
      </Text>
      {gates.map((item) => (
        <GateRow key={item.key} item={item} showWhy={!item.passed} />
      ))}

      <Text style={[common.cardTitle, { marginTop: spacing.md, fontSize: 14 }]}>
        Independent signals
      </Text>
      <Text style={common.cardBody}>
        Buy only when several of these agree — not because one metric looks exciting.
      </Text>
      {signals.map((item) => (
        <GateRow key={item.key} item={item} showWhy={item.status === 'NEUTRAL'} />
      ))}

      {blockingFails.length > 0 ? (
        <Text style={[common.cardBody, { marginTop: spacing.md, color: colors.warn }]}>
          Rejected on: {blockingFails.map((f) => f.label).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

function GateRow({
  item,
  showWhy,
}: {
  item: WhyNotBuyItemView;
  showWhy: boolean;
}) {
  const tone =
    item.status === 'PASS' ? 'ok' : item.status === 'NEUTRAL' ? 'info' : 'danger';
  const mark =
    item.status === 'PASS' ? 'PASS' : item.status === 'NEUTRAL' ? 'NO DATA' : 'FAIL';
  return (
    <View style={{ marginTop: 10 }}>
      <View style={common.row}>
        <Text style={[common.cardBody, { color: colors.text, flex: 1 }]}>{item.label}</Text>
        <StatusBadge label={mark} tone={tone} />
      </View>
      <Text style={common.cardBody}>
        {item.value}
        {item.detail ? ` · ${item.detail}` : ''}
      </Text>
      {showWhy ? (
        <Text style={[common.cardBody, { marginTop: 4, color: colors.muted }]}>
          Why this matters: {item.whyItMatters}
        </Text>
      ) : null}
    </View>
  );
}
