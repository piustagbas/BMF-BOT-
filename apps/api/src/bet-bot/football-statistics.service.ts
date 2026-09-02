import { Injectable } from '@nestjs/common';
import type { NormalizedAnalysis, NormalizedFixture, NormalizedResult, NormalizedStanding, NormalizedTeamStatistics } from './football-data.types';
import type { TeamMatchRow, TeamSnapshot } from './types';

function rate(hits: number, sample: number): number | null {
  return sample ? Math.round((hits / sample) * 1000) / 10 : null;
}

function weightedAverage(rows: TeamMatchRow[], selector: (row: TeamMatchRow) => number): number | null {
  if (!rows.length) return null;
  let total = 0;
  let weights = 0;
  rows.slice(0, 10).forEach((row, index) => {
    const weight = Math.pow(0.85, index);
    total += selector(row) * weight;
    weights += weight;
  });
  return weights ? Math.round((total / weights) * 100) / 100 : null;
}

function form(rows: TeamMatchRow[], count: number): string[] {
  return rows.slice(0, count).map((row) => (row.gf > row.ga ? 'W' : row.gf === row.ga ? 'D' : 'L'));
}

function h2h(home: TeamSnapshot, away: TeamSnapshot): NormalizedAnalysis['h2h'] {
  const awayName = away.name.toLowerCase();
  const rows = (home.recent ?? []).filter((row) => {
    const opponent = row.opponent.toLowerCase();
    return opponent.includes(awayName) || awayName.includes(opponent);
  });
  if (!rows.length) {
    return {
      sampleSize: 0,
      homeWins: 0,
      awayWins: 0,
      draws: 0,
      averageGoals: null,
      bttsRate: null,
      over15Rate: null,
      over25Rate: null,
      over35Rate: null,
    };
  }
  return {
    sampleSize: rows.length,
    homeWins: rows.filter((row) => row.gf > row.ga).length,
    awayWins: rows.filter((row) => row.gf < row.ga).length,
    draws: rows.filter((row) => row.gf === row.ga).length,
    averageGoals: Math.round((rows.reduce((sum, row) => sum + row.gf + row.ga, 0) / rows.length) * 100) / 100,
    bttsRate: rate(rows.filter((row) => row.gf > 0 && row.ga > 0).length, rows.length),
    over15Rate: rate(rows.filter((row) => row.gf + row.ga > 1).length, rows.length),
    over25Rate: rate(rows.filter((row) => row.gf + row.ga > 2).length, rows.length),
    over35Rate: rate(rows.filter((row) => row.gf + row.ga > 3).length, rows.length),
  };
}

function splitStats(snapshot: TeamSnapshot, scope: 'home' | 'away'): NormalizedTeamStatistics | null {
  const split = scope === 'home' ? snapshot.homeSplit : snapshot.awaySplit;
  if (!split?.played) return null;
  return {
    provider: 'footballDataOrg',
    team: {
      id: snapshot.id,
      name: snapshot.name,
      sources: [],
    },
    scope,
    matches: split.played,
    wins: split.wins,
    draws: split.draws,
    losses: split.losses,
    goalsFor: split.gf,
    goalsAgainst: split.ga,
    cleanSheets: split.cleanSheets,
    failedToScore: split.failedToScore,
    source: {
      provider: 'footballDataOrg',
      fetchedAt: new Date().toISOString(),
    },
  };
}

function standingFor(snapshot: TeamSnapshot, standings: NormalizedStanding[]): NormalizedStanding | null {
  return standings.find((row) =>
    (snapshot.id && row.team.id === snapshot.id) ||
    row.team.name.toLowerCase() === snapshot.name.toLowerCase(),
  ) ?? null;
}

@Injectable()
export class FootballStatisticsService {
  build(
    fixture: NormalizedFixture,
    home: TeamSnapshot,
    away: TeamSnapshot,
    providerResults: NormalizedResult[],
    advanced: NormalizedTeamStatistics[] = [],
    standings: NormalizedStanding[] = [],
  ): NormalizedAnalysis {
    const homeRows = home.recent ?? [];
    const awayRows = away.recent ?? [];
    const homeAdvanced = advanced.find((row) => row.team.name === home.name && row.scope === 'home') ?? null;
    const awayAdvanced = advanced.find((row) => row.team.name === away.name && row.scope === 'away') ?? null;
    const leagueHome = providerResults.find((row) => row.homeTeam.name === home.name);
    const leagueAway = providerResults.find((row) => row.awayTeam.name === away.name);
    const xg = (homeAdvanced?.xg ?? null) != null && (awayAdvanced?.xg ?? null) != null
      ? Math.round((((homeAdvanced?.xg ?? 0) + (awayAdvanced?.xg ?? 0)) / 2) * 100) / 100
      : null;
    return {
      fixture,
      recentForm: {
        homeLast5: form(homeRows, 5),
        awayLast5: form(awayRows, 5),
        homeLast10: form(homeRows, 10),
        awayLast10: form(awayRows, 10),
        homeWeightedPoints: weightedAverage(homeRows, (row) => row.gf > row.ga ? 3 : row.gf === row.ga ? 1 : 0),
        awayWeightedPoints: weightedAverage(awayRows, (row) => row.gf > row.ga ? 3 : row.gf === row.ga ? 1 : 0),
      },
      homeAwayStats: {
        home: homeAdvanced ?? splitStats(home, 'home'),
        away: awayAdvanced ?? splitStats(away, 'away'),
      },
      h2h: h2h(home, away),
      leagueStats: {
        homeStanding: standingFor(home, standings),
        awayStanding: standingFor(away, standings),
        averageGoals: leagueHome && leagueAway ? Math.round(((leagueHome.homeGoals + leagueHome.awayGoals + leagueAway.homeGoals + leagueAway.awayGoals) / 2) * 100) / 100 : null,
        homeAdvantage: null,
      },
      advancedStats: {
        xg,
        xga: homeAdvanced?.xga != null && awayAdvanced?.xga != null ? Math.round(((homeAdvanced.xga + awayAdvanced.xga) / 2) * 100) / 100 : null,
        shots: homeAdvanced?.shots != null && awayAdvanced?.shots != null ? homeAdvanced.shots + awayAdvanced.shots : null,
        shotsOnTarget: homeAdvanced?.shotsOnTarget != null && awayAdvanced?.shotsOnTarget != null ? homeAdvanced.shotsOnTarget + awayAdvanced.shotsOnTarget : null,
        possessionPct: homeAdvanced?.possessionPct != null && awayAdvanced?.possessionPct != null ? Math.round(((homeAdvanced.possessionPct + awayAdvanced.possessionPct) / 2) * 10) / 10 : null,
        corners: homeAdvanced?.corners != null && awayAdvanced?.corners != null ? homeAdvanced.corners + awayAdvanced.corners : null,
        cards: homeAdvanced?.cards != null && awayAdvanced?.cards != null ? homeAdvanced.cards + awayAdvanced.cards : null,
      },
      odds: [],
      modelProbabilities: [],
      providerConsensus: {
        available: 0,
        total: 3,
        score: 0,
        label: '0/3',
        discrepancies: [],
      },
      dataQuality: homeRows.length >= 8 && awayRows.length >= 8
        ? standingFor(home, standings) && standingFor(away, standings) ? 'high' : 'medium'
        : 'low',
      insufficientData: homeRows.length < 3 || awayRows.length < 3,
    };
  }
}
