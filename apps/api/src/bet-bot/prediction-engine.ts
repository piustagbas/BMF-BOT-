import { Injectable } from '@nestjs/common';
import type { MarketPrediction, NormalizedAnalysis, NormalizedOdds, PredictionRisk } from './football-data.types';
import type { TeamSnapshot } from './types';

function poisson(k: number, lambda: number): number {
  let value = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) value *= lambda / i;
  return value;
}

function scoreMatrix(homeLambda: number, awayLambda: number): number[][] {
  const matrix: number[][] = [];
  for (let home = 0; home <= 10; home += 1) {
    matrix[home] = [];
    for (let away = 0; away <= 10; away += 1) matrix[home]![away] = poisson(home, homeLambda) * poisson(away, awayLambda);
  }
  const total = matrix.flat().reduce((sum, value) => sum + value, 0);
  if (total > 0) return matrix.map((row) => row.map((value) => value / total));
  return matrix;
}

function sumWhere(matrix: number[][], predicate: (home: number, away: number) => boolean): number {
  return matrix.reduce(
    (total, row, home) => total + row.reduce((line, value, away) => line + (predicate(home, away) ? value : 0), 0),
    0,
  );
}

function recentAverage(snapshot: TeamSnapshot, key: 'gf' | 'ga'): number | null {
  const rows = (snapshot.recent ?? []).slice(0, 10);
  if (!rows.length) return null;
  let total = 0;
  let weights = 0;
  rows.forEach((row, index) => {
    const weight = Math.pow(0.85, index);
    total += row[key] * weight;
    weights += weight;
  });
  return weights ? total / weights : null;
}

function oddsFor(odds: NormalizedOdds[], market: string, selection: string): number | null {
  const hit = odds.find((row) => row.market.toLowerCase() === market.toLowerCase() && row.selection.toLowerCase() === selection.toLowerCase());
  return hit?.decimalOdds && hit.decimalOdds > 1 ? hit.decimalOdds : null;
}

@Injectable()
export class PredictionEngine {
  calculate(
    analysis: NormalizedAnalysis,
    home: TeamSnapshot,
    away: TeamSnapshot,
    providerAgreement = analysis.providerConsensus,
  ): MarketPrediction[] {
    const homeSample = home.recent?.length ?? 0;
    const awaySample = away.recent?.length ?? 0;
    if (homeSample < 3 || awaySample < 3) return [];
    const homeAttack = recentAverage(home, 'gf') ?? 0;
    const awayDefense = recentAverage(away, 'ga') ?? 0;
    const awayAttack = recentAverage(away, 'gf') ?? 0;
    const homeDefense = recentAverage(home, 'ga') ?? 0;
    const homeLambda = Math.max(0.15, Math.min(4, homeAttack * 0.58 + awayDefense * 0.30 + 0.25));
    const awayLambda = Math.max(0.15, Math.min(3.5, awayAttack * 0.58 + homeDefense * 0.30));
    const matrix = scoreMatrix(homeLambda, awayLambda);
    const homeWin = sumWhere(matrix, (h, a) => h > a);
    const draw = sumWhere(matrix, (h, a) => h === a);
    const awayWin = sumWhere(matrix, (h, a) => h < a);
    const totalOver = (line: number) => sumWhere(matrix, (h, a) => h + a > line);
    const homeScores = sumWhere(matrix, (h) => h > 0);
    const awayScores = sumWhere(matrix, (_h, a) => a > 0);
    const btts = sumWhere(matrix, (h, a) => h > 0 && a > 0);
    const quality = analysis.dataQuality;
    const consistency = Math.abs(homeAttack - awayAttack) < 1.8 && Math.abs(homeDefense - awayDefense) < 1.8 ? 1 : 0.65;
    const sampleFactor = Math.min(1, (homeSample + awaySample) / 20);
    const baseConfidence = Math.round(Math.min(92, 35 + sampleFactor * 32 + (quality === 'high' ? 20 : quality === 'medium' ? 12 : 4) + providerAgreement.score * 0.08) * consistency);
    const rows: Array<{ market: string; selection: string; probability: number }> = [
      { market: '1X2', selection: 'HOME', probability: homeWin },
      { market: '1X2', selection: 'DRAW', probability: draw },
      { market: '1X2', selection: 'AWAY', probability: awayWin },
      { market: 'DOUBLE_CHANCE', selection: '1X', probability: homeWin + draw },
      { market: 'DOUBLE_CHANCE', selection: 'X2', probability: awayWin + draw },
      { market: 'DOUBLE_CHANCE', selection: '12', probability: homeWin + awayWin },
      ...[0.5, 1.5, 2.5, 3.5].flatMap((line) => [
        { market: 'TOTALS', selection: `OVER_${line}`, probability: totalOver(line) },
        { market: 'TOTALS', selection: `UNDER_${line}`, probability: 1 - totalOver(line) },
      ]),
      { market: 'BTTS', selection: 'YES', probability: btts },
      { market: 'BTTS', selection: 'NO', probability: 1 - btts },
      { market: 'TEAM_TOTALS', selection: 'HOME_OVER_0.5', probability: homeScores },
      { market: 'TEAM_TOTALS', selection: 'AWAY_OVER_0.5', probability: awayScores },
    ];
    return rows.map((row) => {
      const probability = Math.round(row.probability * 1000) / 10;
      const decimalOdds = oddsFor(analysis.odds, row.market, row.selection);
      const impliedProbability = decimalOdds ? Math.round((1 / decimalOdds) * 1000) / 10 : null;
      const valueEdge = impliedProbability == null ? null : Math.round((probability - impliedProbability) * 10) / 10;
      const confidence = Math.max(0, Math.min(100, baseConfidence - (row.market === '1X2' && probability < 35 ? 5 : 0)));
      const risk: PredictionRisk = confidence >= 75 && probability >= 65 ? 'low' : confidence >= 55 ? 'medium' : 'high';
      const modelScore = Math.round((probability * 0.55 + confidence * 0.2 + providerAgreement.score * 0.15 + (valueEdge == null ? 5 : Math.max(-5, Math.min(10, valueEdge))) * 1.0) * 10) / 10;
      return {
        market: row.market,
        selection: row.selection,
        probability,
        confidence,
        risk,
        dataQuality: quality,
        sampleSize: homeSample + awaySample,
        providerAgreement,
        modelScore,
        impliedProbability,
        valueEdge,
        historicalPerformance: null,
        reason: `Poisson model uses weighted recent goals, home advantage, and defensive rates from ${homeSample + awaySample} pre-kickoff results. H2H is not used as a dominant feature.`,
      };
    });
  }
}
