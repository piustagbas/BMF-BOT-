import { Injectable, Logger } from '@nestjs/common';
import { getJson } from './football-data.utils';
import type { NormalizedAnalysis, StructuredOpenAiAnalysis } from './football-data.types';

@Injectable()
export class OpenAiAnalysisService {
  private readonly logger = new Logger(OpenAiAnalysisService.name);

  configured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_KEY?.trim());
  }

  async analyze(analysis: NormalizedAnalysis): Promise<StructuredOpenAiAnalysis | null> {
    const key = process.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_KEY?.trim();
    if (!key || analysis.insufficientData || !analysis.modelProbabilities.length) return null;
    const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
    const payload = {
      fixture: analysis.fixture,
      recentForm: analysis.recentForm,
      homeAwayStats: analysis.homeAwayStats,
      h2h: analysis.h2h,
      leagueStats: analysis.leagueStats,
      advancedStats: analysis.advancedStats,
      odds: analysis.odds,
      modelProbabilities: analysis.modelProbabilities,
      providerConsensus: analysis.providerConsensus,
      dataQuality: analysis.dataQuality,
    };
    try {
      const result = await getJson(`${baseUrl}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
          store: false,
          instructions: [
            'Analyze only the structured football data supplied in the user input.',
            'Never invent statistics, odds, injuries, lineups, provider findings, or certainty.',
            'Reject insufficient data. Identify conflicts and explain the mathematical evidence.',
            'Do not call any match guaranteed, sure, fixed, or a guaranteed profit.',
            'Return JSON matching the supplied schema.',
          ].join(' '),
          input: JSON.stringify(payload),
          text: {
            format: {
              type: 'json_schema',
              name: 'football_analysis',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['fixture', 'bestPrediction', 'alternativePredictions', 'providerConsensus', 'dataQuality', 'overallAssessment', 'recommendation'],
                properties: {
                  fixture: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['home', 'away', 'league', 'date'],
                    properties: { home: { type: 'string' }, away: { type: 'string' }, league: { type: 'string' }, date: { type: 'string' } },
                  },
                  bestPrediction: {
                    anyOf: [
                      { type: 'null' },
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['market', 'selection', 'probability', 'confidence', 'risk', 'reason'],
                        properties: {
                          market: { type: 'string' },
                          selection: { type: 'string' },
                          probability: { type: 'number' },
                          confidence: { type: 'number' },
                          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
                          reason: { type: 'string' },
                        },
                      },
                    ],
                  },
                  alternativePredictions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['market', 'selection', 'probability', 'reason'],
                      properties: { market: { type: 'string' }, selection: { type: 'string' }, probability: { type: 'number' }, reason: { type: 'string' } },
                    },
                  },
                  providerConsensus: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['sportmonks', 'apiFootball', 'footballDataOrg'],
                    properties: { sportmonks: { type: 'string' }, apiFootball: { type: 'string' }, footballDataOrg: { type: 'string' } },
                  },
                  dataQuality: { type: 'string', enum: ['high', 'medium', 'low'] },
                  overallAssessment: { type: 'string' },
                  recommendation: { type: 'string', enum: ['strong', 'moderate', 'avoid'] },
                },
              },
            },
          },
        }),
      }, 20000);
      if (!result.response.ok) {
        this.logger.warn(`OpenAI analysis HTTP ${result.response.status}`);
        return null;
      }
      const text = this.outputText(result.body);
      if (!text) return null;
      const parsed: unknown = JSON.parse(text);
      if (!this.isStructured(parsed)) return null;
      const home = parsed.fixture.home.toLowerCase();
      const away = parsed.fixture.away.toLowerCase();
      if (home !== analysis.fixture.homeTeam.name.toLowerCase() || away !== analysis.fixture.awayTeam.name.toLowerCase()) return null;
      if (parsed.bestPrediction && !analysis.modelProbabilities.some(
        (prediction) => prediction.market === parsed.bestPrediction?.market && prediction.selection === parsed.bestPrediction?.selection,
      )) return null;
      return parsed;
    } catch (error) {
      this.logger.warn(`OpenAI analysis unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
      return null;
    }
  }

  private outputText(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.output_text === 'string') return row.output_text;
    const output = Array.isArray(row.output) ? row.output : [];
    for (const item of output) {
      if (!item || typeof item !== 'object') continue;
      const rawContent = (item as Record<string, unknown>).content;
      const content: unknown[] = Array.isArray(rawContent) ? rawContent : [];
      for (const part of content) {
        if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
          return (part as Record<string, string>).text;
        }
      }
    }
    return null;
  }

  private isStructured(value: unknown): value is StructuredOpenAiAnalysis {
    if (!value || typeof value !== 'object') return false;
    const row = value as Partial<StructuredOpenAiAnalysis>;
    return Boolean(
      row.fixture &&
      typeof row.fixture.home === 'string' &&
      typeof row.fixture.away === 'string' &&
      typeof row.overallAssessment === 'string' &&
      Array.isArray(row.alternativePredictions) &&
      row.providerConsensus &&
      ['high', 'medium', 'low'].includes(row.dataQuality ?? ''),
    );
  }
}
