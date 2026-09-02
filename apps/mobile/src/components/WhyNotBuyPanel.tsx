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
  testsPassed?: boolean;
};

export function hardTestsPassed(panel: WhyNotBuyView): boolean {
  if (typeof panel.testsPassed === 'boolean') return panel.testsPassed;
  return panel.items.filter((i) => i.blocking && !i.passed).length === 0 && panel.title === 'Why This Passed';
}

export function WhyNotBuyPanel({ panel }: { panel: WhyNotBuyView }) {
  const passed = hardTestsPassed(panel);
  const blockingFails = panel.items.filter((i) => i.blocking && !i.passed);
  const signals = panel.items.filter((i) => i.key.startsWith('sig_'));
  const gates = panel.items.filter((i) => i.blocking);

  return (
    <View style={common.card}>
      <View style={common.row}>
        <Text style={common.cardTitle}>{panel.title}</Text>
        <StatusBadge
          label={passed ? panel.decision : 'DO NOT BUY'}
          tone={passed ? 'ok' : 'danger'}
        />
      </View>
      <Text
        style={[
          common.cardBody,
          { marginTop: 4, color: passed ? colors.text : colors.danger, fontWeight: passed ? '400' : '700' },
        ]}
      >
        {passed
          ? panel.summary
          : panel.summary ||
            'Tests did not pass. Do not buy — this is how you avoid running a loss.'}
      </Text>
      {!passed ? (
        <Text style={[common.cardBody, { marginTop: 8, color: colors.warn }]}>
          Seeing BUY or ENTER on the clock does not override a failed test. Wait for a green
          “Why This Passed” card.
        </Text>
      ) : (
        <Text style={[common.cardBody, { marginTop: 8, color: colors.accent }]}>
          Hard tests passed. This is still a potential setup only — never guaranteed profit.
        </Text>
      )}
      <Text style={[common.cardBody, { marginTop: 8 }]}>
        Buy score {Math.round(panel.buyScore)} · Safety {Math.round(panel.safetyScore)} ·
        Independent {panel.agreeing}/{panel.required} agree ({panel.available} available)
      </Text>

      <Text style={[common.cardTitle, { marginTop: spacing.md, fontSize: 14 }]}>
        Hard tests (all must pass)
      </Text>
      {gates.map((item) => (
        <GateRow key={item.key} item={item} showWhy={!item.passed} independent={false} />
      ))}

      <Text style={[common.cardTitle, { marginTop: spacing.md, fontSize: 14 }]}>
        Independent signals
      </Text>
      <Text style={common.cardBody}>
        Buy only when several of these agree — a DISAGREE here is a vote, not a green light by
        itself.
      </Text>
      {signals.map((item) => (
        <GateRow key={item.key} item={item} showWhy={item.status === 'NEUTRAL'} independent />
      ))}

      {blockingFails.length > 0 ? (
        <Text style={[common.cardBody, { marginTop: spacing.md, color: colors.danger, fontWeight: '700' }]}>
          Do not trade — failed: {blockingFails.map((f) => f.label).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

function GateRow({
  item,
  showWhy,
  independent,
}: {
  item: WhyNotBuyItemView;
  showWhy: boolean;
  independent: boolean;
}) {
  const tone =
    item.status === 'PASS' ? 'ok' : item.status === 'NEUTRAL' ? 'info' : 'danger';
  const mark = independent
    ? item.status === 'PASS'
      ? 'AGREE'
      : item.status === 'NEUTRAL'
        ? 'NO DATA'
        : 'DISAGREE'
    : item.status === 'PASS'
      ? 'PASS'
      : item.status === 'NEUTRAL'
        ? 'NO DATA'
        : 'FAIL';
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
