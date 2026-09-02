import { Injectable } from '@nestjs/common';
import type { MarketPrediction, NormalizedResult } from './football-data.types';

export type BacktestReport = {
  matches: number;
  predictions: number;
  accuracy: number | null;
  brierScore: number | null;
  calibration: number | null;
  roiPct: number | null;
  byMarket: Record<string, { predictions: number; accuracy: number | null; brierScore: number | null }>;
  note: string;
};

function outcomeFor(prediction: MarketPrediction, result: NormalizedResult): boolean | null {
  const total = result.homeGoals + result.awayGoals;
  switch (`${prediction.market}:${prediction.selection}`) {
    case '1X2:HOME': return result.homeGoals > result.awayGoals;
    case '1X2:DRAW': return result.homeGoals === result.awayGoals;
    case '1X2:AWAY': return result.homeGoals < result.awayGoals;
    case 'DOUBLE_CHANCE:1X': return result.homeGoals >= result.awayGoals;
    case 'DOUBLE_CHANCE:X2': return result.awayGoals >= result.homeGoals;
    case 'DOUBLE_CHANCE:12': return result.homeGoals !== result.awayGoals;
    case 'TOTALS:OVER_0.5': return total > 0;
    case 'TOTALS:OVER_1.5': return total > 1;
    case 'TOTALS:OVER_2.5': return total > 2;
    case 'TOTALS:OVER_3.5': return total > 3;
    case 'TOTALS:UNDER_0.5': return total <= 0;
    case 'TOTALS:UNDER_1.5': return total <= 1;
    case 'TOTALS:UNDER_2.5': return total <= 2;
    case 'TOTALS:UNDER_3.5': return total <= 3;
    case 'BTTS:YES': return result.homeGoals > 0 && result.awayGoals > 0;
    case 'BTTS:NO': return result.homeGoals === 0 || result.awayGoals === 0;
    case 'TEAM_TOTALS:HOME_OVER_0.5': return result.homeGoals > 0;
    case 'TEAM_TOTALS:AWAY_OVER_0.5': return result.awayGoals > 0;
    default: return null;
  }
}

@Injectable()
export class BacktestingService {
  evaluate(
    rows: Array<{ result: NormalizedResult; predictions: MarketPrediction[]; generatedAt: string }>,
  ): BacktestReport {
    const byMarket: BacktestReport['byMarket'] = {};
    let correct = 0;
    let brierTotal = 0;
    let count = 0;
    let roiTotal = 0;
    let roiCount = 0;
    for (const row of rows) {
      if (Date.parse(row.generatedAt) >= Date.parse(row.result.kickoffUtc)) continue;
      for (const prediction of row.predictions) {
        const outcome = outcomeFor(prediction, row.result);
        if (outcome == null) continue;
        const key = `${prediction.market}:${prediction.selection}`;
        const entry = byMarket[key] ?? { predictions: 0, accuracy: null, brierScore: null };
        entry.predictions += 1;
        entry.accuracy = ((entry.accuracy ?? 0) * (entry.predictions - 1) + (outcome ? 1 : 0)) / entry.predictions;
        entry.brierScore = ((entry.brierScore ?? 0) * (entry.predictions - 1) + Math.pow(prediction.probability / 100 - (outcome ? 1 : 0), 2)) / entry.predictions;
        byMarket[key] = entry;
        correct += outcome ? 1 : 0;
        brierTotal += Math.pow(prediction.probability / 100 - (outcome ? 1 : 0), 2);
        count += 1;
        if (prediction.impliedProbability != null) {
          roiTotal += outcome ? Math.max(0, 100 / prediction.impliedProbability - 1) : -1;
          roiCount += 1;
        }
      }
    }
    const accuracy = count ? Math.round((correct / count) * 1000) / 10 : null;
    const brierScore = count ? Math.round((brierTotal / count) * 10000) / 10000 : null;
    const calibration = count ? Math.round((1 - (brierScore ?? 1)) * 1000) / 10 : null;
    return {
      matches: rows.length,
      predictions: count,
      accuracy,
      brierScore,
      calibration,
      roiPct: roiCount ? Math.round((roiTotal / roiCount) * 1000) / 10 : null,
      byMarket,
      note: count
        ? 'Evaluation includes only predictions generated before the recorded kickoff. ROI is a simple flat-stake simulation where odds existed; it is not a profit guarantee.'
        : 'No leakage-safe historical predictions with matching finished results are stored yet. No performance claim is made.',
    };
  }
}
