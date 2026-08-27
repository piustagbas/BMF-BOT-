import { fetchWithTimeout } from '@memecoinbot/data-providers';
import { PLAYABLE_MARKETS, setRecommended, styleFit } from './analysis';
import { formSignals } from './matchStats';
import { MARKET_LABELS } from './popular';
import type { AiMatchAnalysis, BetMarket, FixtureAnalysis, TeamMatchRow, TeamSnapshot } from './types';

const ALLOWED = [...PLAYABLE_MARKETS];

export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_KEY?.trim());
}

export function openaiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
}

function openaiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_KEY?.trim() || null;
}

function openaiBase(): string {
  return (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
}

function fmtRows(name: string, rows: TeamMatchRow[] | undefined): string {
  const slice = (rows ?? []).slice(0, 5);
  if (!slice.length) return `${name}: UNKNOWN — no recent results in the feed.`;
  const lines = slice.map((r, i) => {
    const total = r.gf + r.ga;
    const ou = total > 2 ? 'over 2.5' : 'under 2.5';
    const res = r.gf > r.ga ? 'W' : r.gf === r.ga ? 'D' : 'L';
    return `${i + 1}. ${r.isHome ? 'H' : 'A'} vs ${r.opponent} ${r.gf}-${r.ga} (${res}, ${ou})`;
  });
  return `${name} last ${slice.length}:\n${lines.join('\n')}`;
}

export function buildMatchBrief(
  analysis: FixtureAnalysis,
  home: TeamSnapshot,
  away: TeamSnapshot,
): string {
  const s = formSignals(home, away);
  const fx = analysis.fixture;
  return [
    `${fx.home.name} vs ${fx.away.name}`,
    `League: ${fx.league} · ${analysis.matchImportance}`,
    `Kickoff: ${fx.kickoffUtc}`,
    fmtRows(home.name, home.recent),
    `Form ${home.name}: last5 ${home.last5 || 'no results'} · ${s.h.gf} gf / ${s.h.ga} ga · ${s.h.wins}/${s.h.n} wins · over 2.5 ${s.h.over25}/${s.h.n} · last match ${s.h.known ? `${s.h.lastTotal} goals (${s.h.lastOver25 ? 'OVER' : 'UNDER'} 2.5)` : 'no results'}`,
    fmtRows(away.name, away.recent),
    `Form ${away.name}: last5 ${away.last5 || 'no results'} · ${s.a.gf} gf / ${s.a.ga} ga · ${s.a.wins}/${s.a.n} wins · over 2.5 ${s.a.over25}/${s.a.n} · last match ${s.a.known ? `${s.a.lastTotal} goals (${s.a.lastOver25 ? 'OVER' : 'UNDER'} 2.5)` : 'no results'}`,
    analysis.h2h,
    analysis.homeAway,
    `Line-up: ${analysis.lineup.confirmed ? 'confirmed' : 'not confirmed'}`,
    home.topScorer ? `Home scorer in sample: ${home.topScorer.name} (${home.topScorer.last5Goals} last-5)` : '',
    away.topScorer ? `Away scorer in sample: ${away.topScorer.name} (${away.topScorer.last5Goals} last-5)` : '',
    `Stats-model candidate (not final): ${analysis.recommended?.label ?? 'none'}`,
    `Allowed markets: ${ALLOWED.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseAiMarket(raw: unknown): BetMarket | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (PLAYABLE_MARKETS.has(t as BetMarket)) return t as BetMarket;
  const upper = t.toUpperCase().replace(/[\s-]+/g, '_');
  if (PLAYABLE_MARKETS.has(upper as BetMarket)) return upper as BetMarket;
  const fold = t.toLowerCase().replace(/[^a-z0-9+]/g, '');
  for (const [code, label] of Object.entries(MARKET_LABELS)) {
    if (!PLAYABLE_MARKETS.has(code as BetMarket)) continue;
    const lf = label.toLowerCase().replace(/[^a-z0-9+]/g, '');
    if (lf && (fold === lf || fold.includes(lf) || lf.includes(fold))) return code as BetMarket;
  }
  return null;
}

export function parseAiJson(text: string): {
  market: BetMarket | null;
  homeRead: string;
  awayRead: string;
  summary: string;
  lean: string;
  why: string[];
  risk: string;
} | null {
  const stripped = text.replace(/```json|```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const row = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
    const why = Array.isArray(row.why) ? row.why.filter((x): x is string => typeof x === 'string').slice(0, 4) : [];
    return {
      market: parseAiMarket(row.market),
      homeRead: typeof row.homeRead === 'string' ? row.homeRead : '',
      awayRead: typeof row.awayRead === 'string' ? row.awayRead : '',
      summary: typeof row.summary === 'string' ? row.summary : '',
      lean: typeof row.lean === 'string' ? row.lean : '',
      why,
      risk: typeof row.risk === 'string' ? row.risk : '',
    };
  } catch {
    return null;
  }
}

export function aiPickAllowed(market: BetMarket, home: TeamSnapshot, away: TeamSnapshot): boolean {
  if (!PLAYABLE_MARKETS.has(market)) return false;
  const s = formSignals(home, away);
  if (market === 'UNDER_2_5' && (s.lastOver || s.eitherOverHeavy)) return false;
  if (market === 'UNDER_10_5_CORNERS' && s.lastOver) return false;
  if (styleFit(market, home, away) < -20) return false;
  return true;
}

function teamRead(name: string, rows: TeamMatchRow[] | undefined, side: 'h' | 'a'): string {
  const sRows = (rows ?? []).slice(0, 5);
  if (!sRows.length) return `${name}: no recent results in the feed — not treated as 0-0.`;
  const last = sRows[0]!;
  const lastOu = last.gf + last.ga > 2 ? 'over 2.5' : 'under 2.5';
  const overs = sRows.filter((r) => r.gf + r.ga > 2).length;
  const wins = sRows.filter((r) => r.gf > r.ga).length;
  return `${name} (${side === 'h' ? 'home' : 'away'}): last match ${last.gf}-${last.ga} vs ${last.opponent} (${lastOu}). Last ${sRows.length}: ${wins} wins, ${overs} over 2.5.`;
}

export function localAnalyst(
  analysis: FixtureAnalysis,
  home: TeamSnapshot,
  away: TeamSnapshot,
): AiMatchAnalysis {
  const s = formSignals(home, away);
  const market = analysis.recommended?.market ?? 'DC_1X';
  let lean = 'mixed';
  if (s.homeStrong && !s.awayStrong) lean = 'home control';
  else if (s.awayStrong && !s.homeStrong) lean = 'away control';
  else if (s.lastOver || s.overRate >= 0.6) lean = 'open / goals';
  else if (s.bothUnderHeavy) lean = 'low scoring';
  else if (s.bothScore) lean = 'both teams scoring';
  else if (s.evenMatch) lean = 'even match';
  const homeRead = teamRead(home.name, home.recent, 'h');
  const awayRead = teamRead(away.name, away.recent, 'a');
  const summary = `${homeRead} ${awayRead} Combined last-match picture: ${lean}. Pick is chosen after this read, not as a default under 2.5.`;
  return {
    source: 'local',
    model: 'stats-analyst',
    summary,
    homeRead,
    awayRead,
    lean,
    market,
    why: analysis.recommended?.whyQualified?.slice(0, 3) ?? [],
    risk: analysis.recommended?.mainRisk ?? 'Recent form can break on the day.',
    note: openaiConfigured()
      ? 'Local pre-read; ChatGPT can override the market when the OpenAI call succeeds.'
      : 'Set OPENAI_API_KEY to use ChatGPT for this step. Until then the bot still analyses both last-match cards first, then picks.',
  };
}

async function chatGptAnalyse(brief: string): Promise<ReturnType<typeof parseAiJson>> {
  const key = openaiKey();
  if (!key) return null;
  const res = await fetchWithTimeout(
    `${openaiBase()}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openaiModel(),
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a football betting analyst. Step 1: analyse BOTH teams from the provided last matches only. Do not invent scores, corners, cards, or injuries. Step 2: pick ONE allowed market that best favours the bettor from that consistency. Never default every game to under 2.5. If either last match was over 2.5, do not pick UNDER_2_5. Prefer home/1X, over 2.5, BTTS, team goals, corners, cards, or player to score when the last results support it. Reply JSON only with keys: homeRead, awayRead, summary, lean, market, why (array of short strings), risk.',
          },
          { role: 'user', content: brief },
        ],
      }),
    },
    14000,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? '';
  return parseAiJson(text);
}

/** Analyse both teams first, then choose the bet. ChatGPT when a key is set; otherwise local pre-read. */
export async function analyseThenPick(
  analysis: FixtureAnalysis,
  home: TeamSnapshot,
  away: TeamSnapshot,
  opts?: { llm?: boolean },
): Promise<FixtureAnalysis> {
  const local = localAnalyst(analysis, home, away);
  let ai = local;
  if (opts?.llm !== false && openaiConfigured()) {
    try {
      const parsed = await chatGptAnalyse(buildMatchBrief(analysis, home, away));
      if (parsed?.market && aiPickAllowed(parsed.market, home, away) && analysis.markets.some((m) => m.market === parsed.market)) {
        ai = {
          source: 'openai',
          model: openaiModel(),
          summary: parsed.summary || local.summary,
          homeRead: parsed.homeRead || local.homeRead,
          awayRead: parsed.awayRead || local.awayRead,
          lean: parsed.lean || local.lean,
          market: parsed.market,
          why: parsed.why.length ? parsed.why : local.why,
          risk: parsed.risk || local.risk,
          note: `ChatGPT (${openaiModel()}) analysed both teams, then selected the market. Not a guarantee.`,
        };
      } else {
        ai = {
          ...local,
          note: parsed?.market
            ? `ChatGPT suggested ${parsed.market} but last-match stats rejected it — kept the form pick.`
            : 'ChatGPT did not return a usable market — kept the form pick after the same two-team read.',
        };
      }
    } catch {
      ai = { ...local, note: 'ChatGPT call failed — kept the two-team form pick.' };
    }
  }
  const next = setRecommended(analysis, ai.market, {
    reason: ai.summary,
    why: [ai.homeRead, ai.awayRead, ...ai.why],
  });
  return { ...next, ai };
}
