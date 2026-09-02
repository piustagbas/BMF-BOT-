import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';

export const betCardStyle = {
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: 14,
  paddingVertical: 12,
  paddingHorizontal: 14,
  marginBottom: 10,
};

export function splitMatch(match?: string, home?: string, away?: string) {
  if (home?.trim() && away?.trim()) return { home: home.trim(), away: away.trim() };
  const parts = (match || '').split(/\s+vs\.?\s+/i);
  return { home: parts[0]?.trim() || 'Home', away: parts[1]?.trim() || 'Away' };
}

export function KickoffDate({ iso }: { iso?: string | null }) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const label = d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <Text style={styles.kickoff} numberOfLines={1}>
      {label}
    </Text>
  );
}

export function countryLeagueLabel(item: {
  leagueHeading?: string;
  countryFlag?: string;
  country?: string;
  league?: string;
}): string {
  if (item.leagueHeading) return item.leagueHeading;
  const flag = item.countryFlag ? `${item.countryFlag} ` : '';
  if (item.country && item.league) return `${flag}${item.country} · ${item.league}`;
  return `${flag}${item.league || item.country || ''}`.trim();
}

export function CountryLeagueLine({
  leagueHeading,
  countryFlag,
  country,
  league,
}: {
  leagueHeading?: string;
  countryFlag?: string;
  country?: string;
  league?: string;
}) {
  const label = countryLeagueLabel({ leagueHeading, countryFlag, country, league });
  if (!label) return null;
  return (
    <Text style={styles.meta} numberOfLines={1}>
      {label}
    </Text>
  );
}

export function SplitTeams({ home, away }: { home: string; away: string }) {
  return (
    <Text style={styles.fixture} numberOfLines={2}>
      {home} vs {away}
    </Text>
  );
}

export type CardLine = { family: string; pct: number; detail: string };

export type MultiScoreBits = {
  side?: 'HOME' | 'AWAY';
  scores: Array<{ line: string; probability: number }>;
  combinedProbability?: number;
};

export function MarketLines({
  lines,
  score,
  stake,
  showMultiscore,
  multiScore,
  safestOnly,
}: {
  lines?: CardLine[] | null;
  score?: number | null;
  stake?: string | null;
  showMultiscore?: boolean;
  multiScore?: MultiScoreBits | null;
  safestOnly?: boolean;
}) {
  const fallback: CardLine[] = [
    {
      family: 'Safest',
      pct: score != null ? Math.round(score) : 0,
      detail: stake?.trim() || '—',
    },
  ];
  const base = (lines && lines.length ? lines : fallback).filter((row) => row.family !== 'Multiscore');
  const rows = showMultiscore ? withMultiscore(base, multiScore) : base;
  const safest = rows.find((row) => row.family === 'Safest');
  const visibleRows = safestOnly ? (safest ? [safest] : fallback) : rows.length ? rows : fallback;
  return (
    <View>
      {visibleRows.map((row, i) => (
        <LineRow key={`${row.family}-${row.detail}-${i}`} row={row} safest={row.family === 'Safest'} />
      ))}
    </View>
  );
}

function LineRow({ row, safest }: { row: CardLine; safest?: boolean }) {
  const pct = Number.isFinite(row.pct) ? Math.round(row.pct) : 0;
  const detail = stripEmbeddedPct(row.detail) || '—';
  return (
    <Text
      style={[styles.line, safest ? styles.safest : styles.extra]}
      numberOfLines={row.family === 'Multiscore' ? 2 : 1}
    >
      {`${row.family} ${pct}% : ${detail}`}
    </Text>
  );
}

function withMultiscore(base: CardLine[], multiScore?: MultiScoreBits | null): CardLine[] {
  const ms = multiScoreLine(multiScore);
  if (!ms) {
    return base.filter((row) => row.family === 'Safest').length ? base.filter((row) => row.family === 'Safest') : base;
  }
  const safest = base.filter((row) => row.family === 'Safest');
  return safest.length ? [...safest, ms] : [ms, ...base.slice(0, 1)];
}

function multiScoreLine(multiScore?: MultiScoreBits | null): CardLine | null {
  if (!multiScore?.scores?.length) return null;
  return {
    family: 'Multiscore',
    pct: Math.min(
      100,
      Math.round(
        multiScore.combinedProbability ??
          multiScore.scores.reduce((s, x) => s + x.probability, 0),
      ),
    ),
    detail: multiScore.scores.map((s) => s.line).join(', '),
  };
}

function stripEmbeddedPct(detail?: string | null): string {
  return (detail ?? '')
    .replace(/\s*\(\s*\d+(?:\.\d+)?\s*%\s*\)\s*/g, '')
    .replace(/^\s*\d+(?:\.\d+)?\s*%\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** @deprecated use MarketLines */
export function SafeStake({
  score,
  stake,
}: {
  score?: number | null;
  stake?: string | null;
}) {
  return <MarketLines score={score} stake={stake} />;
}

const styles = StyleSheet.create({
  fixture: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  kickoff: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 2,
  },
  meta: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  line: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 2,
  },
  safest: {
    color: colors.accent,
    fontWeight: '800',
  },
  extra: {
    color: colors.text,
    fontWeight: '600',
    paddingLeft: 10,
  },
});
