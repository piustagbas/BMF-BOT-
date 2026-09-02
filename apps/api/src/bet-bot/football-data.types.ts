export type FootballProviderName = 'sportmonks' | 'apiFootball' | 'footballDataOrg';

export type FootballProviderStatus = 'connected' | 'disabled' | 'error';

export type DataQuality = 'high' | 'medium' | 'low';
export type PredictionRisk = 'low' | 'medium' | 'high';

export type SourceRef = {
  provider: FootballProviderName;
  providerId?: string;
  fetchedAt: string;
  stale?: boolean;
};

export type NormalizedTeam = {
  id?: string;
  name: string;
  shortName?: string;
  country?: string;
  logoUrl?: string;
  sources: SourceRef[];
};

export type NormalizedFixture = {
  internalId: string;
  provider: FootballProviderName;
  providerFixtureId: string;
  leagueId?: string;
  leagueName?: string;
  season?: string;
  date: string;
  kickoffUtc: string;
  kickoffLocal: string;
  timezone: string;
  homeTeam: NormalizedTeam;
  awayTeam: NormalizedTeam;
  status?: string;
  venue?: string;
  source: SourceRef;
  discrepancies?: string[];
};

export type NormalizedResult = NormalizedFixture & {
  homeGoals: number;
  awayGoals: number;
  halftimeHomeGoals?: number;
  halftimeAwayGoals?: number;
  finishedAt?: string;
};

export type NormalizedLeagueSeason = {
  provider: FootballProviderName;
  providerLeagueId: string;
  providerSeasonId?: string;
  leagueName: string;
  country?: string;
  season?: string;
  source: SourceRef;
};

export type NormalizedStanding = {
  provider: FootballProviderName;
  leagueId?: string;
  season?: string;
  team: NormalizedTeam;
  position?: number;
  played?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  goalDifference?: number;
  points?: number;
  form?: string;
  stage?: string;
  group?: string;
  details?: unknown[];
  source: SourceRef;
};

export type NormalizedTeamStatistics = {
  provider: FootballProviderName;
  team: NormalizedTeam;
  leagueId?: string;
  season?: string;
  scope: 'overall' | 'home' | 'away';
  matches?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  cleanSheets?: number;
  failedToScore?: number;
  xg?: number;
  xga?: number;
  shots?: number;
  shotsOnTarget?: number;
  possessionPct?: number;
  corners?: number;
  cards?: number;
  source: SourceRef;
};

export type NormalizedFixtureStatistics = {
  provider: FootballProviderName;
  fixtureId: string;
  home: Omit<NormalizedTeamStatistics, 'team' | 'scope'>;
  away: Omit<NormalizedTeamStatistics, 'team' | 'scope'>;
  source: SourceRef;
};

export type NormalizedHeadToHead = {
  provider: FootballProviderName;
  homeTeam: NormalizedTeam;
  awayTeam: NormalizedTeam;
  results: NormalizedResult[];
  source: SourceRef;
};

export type NormalizedOdds = {
  provider: FootballProviderName;
  fixtureId: string;
  market: string;
  selection: string;
  decimalOdds: number;
  bookmaker?: string;
  capturedAt: string;
  source: SourceRef;
};

export type ProviderHealth = {
  provider: FootballProviderName;
  status: FootballProviderStatus;
  responseTimeMs: number | null;
  errors: number;
  rateLimitResponses: number;
  lastSuccessfulSync: string | null;
  fixturesReceived: number;
  message?: string;
};

export type ProviderFetchOptions = {
  dateFrom: string;
  dateTo: string;
  timezone: string;
};

export type ProviderFetchResult = {
  provider: FootballProviderName;
  fixtures: NormalizedFixture[];
  results: NormalizedResult[];
  leagues: NormalizedLeagueSeason[];
  standings: NormalizedStanding[];
  teamStatistics: NormalizedTeamStatistics[];
  fixtureStatistics: NormalizedFixtureStatistics[];
  headToHeads: NormalizedHeadToHead[];
  odds: NormalizedOdds[];
  health: ProviderHealth;
  warning?: string;
};

export interface FootballDataProvider {
  readonly name: FootballProviderName;
  configured(): boolean;
  fetch(options: ProviderFetchOptions): Promise<ProviderFetchResult>;
}

export type FootballProviderAdapter = FootballDataProvider;

export type ProviderAgreement = {
  available: number;
  total: number;
  score: number;
  label: string;
  discrepancies: string[];
};

export type MarketPrediction = {
  market: string;
  selection: string;
  probability: number;
  confidence: number;
  risk: PredictionRisk;
  dataQuality: DataQuality;
  sampleSize: number;
  providerAgreement: ProviderAgreement;
  modelScore: number;
  impliedProbability: number | null;
  valueEdge: number | null;
  historicalPerformance: number | null;
  reason: string;
  outcome?: 'won' | 'lost' | 'void' | 'pending';
};

export type NormalizedAnalysis = {
  fixture: NormalizedFixture;
  recentForm: {
    homeLast5: string[];
    awayLast5: string[];
    homeLast10: string[];
    awayLast10: string[];
    homeWeightedPoints: number | null;
    awayWeightedPoints: number | null;
  };
  homeAwayStats: {
    home: NormalizedTeamStatistics | null;
    away: NormalizedTeamStatistics | null;
  };
  h2h: {
    sampleSize: number;
    homeWins: number;
    awayWins: number;
    draws: number;
    averageGoals: number | null;
    bttsRate: number | null;
    over15Rate: number | null;
    over25Rate: number | null;
    over35Rate: number | null;
  };
  leagueStats: {
    homeStanding: NormalizedStanding | null;
    awayStanding: NormalizedStanding | null;
    averageGoals: number | null;
    homeAdvantage: number | null;
  };
  advancedStats: {
    xg: number | null;
    xga: number | null;
    shots: number | null;
    shotsOnTarget: number | null;
    possessionPct: number | null;
    corners: number | null;
    cards: number | null;
  };
  odds: NormalizedOdds[];
  modelProbabilities: MarketPrediction[];
  providerConsensus: ProviderAgreement;
  dataQuality: DataQuality;
  insufficientData: boolean;
  openAi?: StructuredOpenAiAnalysis;
};

export type StructuredOpenAiAnalysis = {
  fixture: { home: string; away: string; league: string; date: string };
  bestPrediction: {
    market: string;
    selection: string;
    probability: number;
    confidence: number;
    risk: PredictionRisk;
    reason: string;
  } | null;
  alternativePredictions: Array<{
    market: string;
    selection: string;
    probability: number;
    reason: string;
  }>;
  providerConsensus: {
    sportmonks: string;
    apiFootball: string;
    footballDataOrg: string;
  };
  dataQuality: DataQuality;
  overallAssessment: string;
  recommendation: 'strong' | 'moderate' | 'avoid';
};
