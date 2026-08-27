export const BET_DISCLAIMER =
  'Betting involves risk of loss. This analysis is not a guarantee of winning, not financial or gambling advice, and no selection is certain. 18+ only where required.';

export type BookmakerId = 'bet9ja' | 'sportybet' | 'third';

export type BetMarket =
  | 'HOME'
  | 'DRAW'
  | 'AWAY'
  | 'DC_1X'
  | 'DC_X2'
  | 'DC_12'
  | 'OVER_0_5'
  | 'OVER_1_5'
  | 'OVER_2_5'
  | 'OVER_3_5'
  | 'UNDER_0_5'
  | 'UNDER_1_5'
  | 'UNDER_2_5'
  | 'UNDER_3_5'
  | 'BTTS_YES'
  | 'BTTS_NO'
  | 'HOME_TO_SCORE'
  | 'AWAY_TO_SCORE'
  | 'OVER_4_5'
  | 'UNDER_4_5'
  | 'HOME_OVER_0_5'
  | 'HOME_OVER_1_5'
  | 'AWAY_OVER_0_5'
  | 'AWAY_OVER_1_5'
  | 'DNB_HOME'
  | 'DNB_AWAY'
  | 'AH_HOME_M05'
  | 'AH_HOME_P05'
  | 'AH_HOME_M15'
  | 'AH_HOME_P15'
  | 'AH_HOME_0'
  | 'AH_AWAY_0'
  | 'OVER_10_5_CORNERS'
  | 'UNDER_10_5_CORNERS'
  | 'OVER_3_5_CARDS'
  | 'UNDER_3_5_CARDS'
  | 'HOME_PLAYER_SCORE'
  | 'AWAY_PLAYER_SCORE'
  | 'HOME_MULTISCORE'
  | 'AWAY_MULTISCORE';

export type PickCategory = 'SAFEST' | 'BEST_VALUE' | 'HIGH_ODDS' | 'AVOID';
export type RiskLevel = 'Low Risk' | 'High Confidence' | 'Qualified' | 'Value' | 'Avoid';

export type BookOdds = {
  bookmaker: BookmakerId;
  label: string;
  decimalOdds: number | null;
  available: boolean;
  note?: string;
};

export type MarketOdds = {
  market: BetMarket;
  label: string;
  books: BookOdds[];
  bestBook: BookmakerId | null;
  bestOdds: number | null;
};

export type SplitStats = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  cleanSheets: number;
  failedToScore: number;
  over05: number;
  over15: number;
  over25: number;
  over35: number;
  over45: number;
  btts: number;
};

export type TeamMatchRow = {
  isHome: boolean;
  gf: number;
  ga: number;
  opponent: string;
  playedAt?: string;
  scorers?: string[];
  cornersFor?: number;
  cornersAgainst?: number;
  yellowsFor?: number;
  yellowsAgainst?: number;
};

export type TeamSnapshot = {
  id: string;
  name: string;
  popular: boolean;
  last5: string;
  last10?: string;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  homeWins?: number;
  awayWins?: number;
  recent?: TeamMatchRow[];
  overall?: SplitStats;
  homeSplit?: SplitStats;
  awaySplit?: SplitStats;
  sampleSize?: number;
  dataReliability?: 'GOOD' | 'LIMITED' | 'UNKNOWN';
  topScorer?: { name: string; goals: number; last5Goals: number };
};

export type ScoreBreakdown = {
  form: number;
  homeAway: number;
  goals: number;
  defense: number;
  delivery: number;
  opponent: number;
  h2h: number;
  squad: number;
  motivation: number;
  context: number;
  data: number;
  value: number;
  total: number;
  band: 'Exceptional' | 'Strong' | 'Good' | 'Watch' | 'REJECT';
};

export type LineupInfo = {
  confirmed: boolean;
  homeXi: string[];
  awayXi: string[];
  missingHome: string[];
  missingAway: string[];
  rotationRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  note: string;
};

export type FixtureSummary = {
  id: string;
  league: string;
  competition: string;
  kickoffUtc: string;
  venue?: string;
  status: string;
  home: { id: string; name: string; popular: boolean };
  away: { id: string; name: string; popular: boolean };
  popularMatch: boolean;
  live?: boolean;
  score?: { home: number | null; away: number | null };
  minute?: string;
  country?: string;
  countryFlag?: string;
  leagueHeading?: string;
};

export type MarketAnalysis = {
  market: BetMarket;
  label: string;
  modelProbability: number;
  impliedProbability: number | null;
  edgePct: number | null;
  safetyScore: number;
  analysisScore: number;
  confidence: number;
  analysedOdds: number | null;
  sampleDeliveryRate: number | null;
  sampleSize: number;
  historicalNote: string;
  odds: MarketOdds;
  category: PickCategory;
  riskLevel: RiskLevel;
  reason: string;
  whyQualified: string[];
  mainRisk: string;
  sources: string[];
  breakdown: ScoreBreakdown;
};

export type TeamFormCard = {
  name: string;
  last5: string;
  last10: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  avgGf: number;
  avgGa: number;
  reliability: string;
  recent: Array<{
    opponent: string;
    gf: number;
    ga: number;
    isHome: boolean;
    result: 'W' | 'D' | 'L';
    playedAt?: string;
  }>;
};

export type MultiScoreLine = {
  line: string;
  home: number;
  away: number;
  probability: number;
};

export type MultiScorePick = {
  side: 'HOME' | 'AWAY';
  label: string;
  scores: MultiScoreLine[];
  combinedProbability: number;
  analysedOdds: number | null;
  reason: string;
};

export type FixtureAnalysis = {
  fixture: FixtureSummary;
  popularity: { home: boolean; away: boolean; note: string };
  strength: { home: number; away: number; note: string };
  form: { home: string; away: string; last10Home?: string; last10Away?: string };
  teamStats: { home: TeamFormCard; away: TeamFormCard };
  homeAway: string;
  h2h: string;
  sources: string[];
  noBet: boolean;
  goals: { homeFor: number; homeAgainst: number; awayFor: number; awayAgainst: number };
  injuries: { home: string[]; away: string[]; note: string };
  lineup: LineupInfo;
  matchImportance: string;
  halfGoalPick: {
    market: BetMarket;
    label: string;
    reason: string;
  } | null;
  markets: MarketAnalysis[];
  recommended: MarketAnalysis | null;
  rankedMarkets?: BetMarket[];
  multiScore?: MultiScorePick;
  avoidReasons: string[];
  disclaimer: string;
  ai?: AiMatchAnalysis;
};

export type AiMatchAnalysis = {
  source: 'openai' | 'local';
  model: string;
  summary: string;
  homeRead: string;
  awayRead: string;
  lean: string;
  market: BetMarket;
  why: string[];
  risk: string;
  note: string;
};
