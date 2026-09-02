import React, { useState } from 'react';
import { Linking, Pressable, Share, Text, View } from 'react-native';
import type { BetBookmakerSlip } from '../../api/client';
import { colors, common, spacing } from '../../theme';
import { MarketLines, SplitTeams, betCardStyle, splitMatch, CountryLeagueLine } from './BetCardLayout';

export function BookmakerSlips({
  slips,
  loading,
}: {
  slips: BetBookmakerSlip[];
  loading?: boolean;
}) {
  const [hint, setHint] = useState<string | null>(null);
  const legs = slips[0]?.legs ?? [];

  if (loading && !slips.length) {
    return (
      <View style={betCardStyle}>
        <Text style={common.cardTitle}>Slip</Text>
        <Text style={common.cardBody}>Building today’s picks…</Text>
      </View>
    );
  }

  if (!slips.length) return null;

  return (
    <View style={{ marginBottom: spacing.sm }}>
      {hint ? (
        <Text style={[common.cardBody, { color: colors.accent, marginBottom: 12 }]}>{hint}</Text>
      ) : null}
      {legs.map((leg, i) => {
        const teams = splitMatch(leg.match);
        return (
          <View key={`${leg.fixtureId}-${leg.pick}-${i}`} style={betCardStyle}>
            <Text style={[common.cardBody, { marginBottom: 6 }]}>{i + 1}.</Text>
            <CountryLeagueLine
              leagueHeading={leg.leagueHeading}
              countryFlag={leg.countryFlag}
              country={leg.country}
              league={leg.league}
            />
            <SplitTeams home={teams.home} away={teams.away} />
            <View style={{ height: 8 }} />
            <MarketLines lines={leg.cardLines} score={leg.safety} stake={leg.pick} />
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {slips.map((book) => (
          <Pressable
            key={book.id}
            style={common.primaryBtn}
            onPress={async () => {
              try {
                await Share.share({ message: book.copyText, title: `${book.label} slip` });
                setHint(`${book.label} slip ready to share.`);
              } catch {
                setHint('Long-press is not needed — use Copy / share.');
              }
            }}
          >
            <Text style={common.primaryBtnText}>Copy {book.label}</Text>
          </Pressable>
        ))}
        {slips[0]?.site ? (
          <Pressable style={common.secondaryBtn} onPress={() => void Linking.openURL(slips[0]!.site!)}>
            <Text style={common.secondaryBtnText}>Open site</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
