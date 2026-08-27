import React, { useState } from 'react';
import { Linking, Platform, Pressable, Share, Text, View } from 'react-native';
import type { BetBookmakerSlip } from '../../api/client';
import { StatusBadge } from '../../components/StatusBadge';
import { colors, common, spacing } from '../../theme';

export function BookmakerSlips({
  slips,
  loading,
}: {
  slips: BetBookmakerSlip[];
  loading?: boolean;
}) {
  const [hint, setHint] = useState<string | null>(null);

  if (loading && !slips.length) {
    return (
      <View style={common.card}>
        <Text style={common.cardTitle}>Safe slips</Text>
        <Text style={common.cardBody}>Building a copy-paste slip for each book…</Text>
      </View>
    );
  }

  if (!slips.length) return null;

  return (
    <View>
      <Text style={[common.cardTitle, { marginBottom: 4 }]}>Copy onto the betting site</Text>
      <Text style={[common.cardBody, { marginBottom: spacing.sm }]}>
        Full safe pack: pick, country · league, and last-5 scores. Copy, then search those matches on the site. No booking code is invented.
      </Text>
      {hint ? (
        <Text style={[common.cardBody, { color: colors.accent, marginBottom: 8 }]}>{hint}</Text>
      ) : null}
      {slips.map((book) => {
        return (
          <View key={book.id} style={common.card}>
            <View style={common.row}>
              <Text style={[common.cardTitle, { flex: 1, flexShrink: 1 }]}>{book.label}</Text>
              <StatusBadge label="NO CODE" tone="warn" />
            </View>
            <Text style={common.cardBody}>
              Safety {book.avgSafety} · delivery {book.avgDelivery}%
            </Text>
            <Text
              selectable
              style={{
                color: colors.text,
                fontSize: 13,
                lineHeight: 20,
                marginTop: 10,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              }}
            >
              {book.copyText}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <Pressable
                style={common.primaryBtn}
                onPress={async () => {
                  try {
                    await Share.share({ message: book.copyText, title: `${book.label} safe slip` });
                    setHint(`${book.label} slip ready to paste on the site.`);
                  } catch {
                    setHint('Long-press the slip text to copy.');
                  }
                }}
              >
                <Text style={common.primaryBtnText}>Copy / share</Text>
              </Pressable>
              {book.site ? (
                <Pressable style={common.secondaryBtn} onPress={() => void Linking.openURL(book.site!)}>
                  <Text style={common.secondaryBtnText}>Open site</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
