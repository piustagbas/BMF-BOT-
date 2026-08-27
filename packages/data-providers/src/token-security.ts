import type { ProviderResult, SourceHealth } from './types';
import { fetchWithTimeout, num } from './http';

const DEFAULT_BASE = 'https://api.rugcheck.xyz/v1';

function baseUrl(): string {
  return (
    process.env.TOKEN_SECURITY_API_URL?.replace(/\/$/, '') || DEFAULT_BASE
  );
}

export type SecurityRisk = {
  name: string;
  level: string;
  score: number | null;
  description?: string;
};

export type SecurityHolder = {
  address: string;
  owner?: string;
  pct: number;
  insider?: boolean;
};

export type TokenSecurityReport = {
  address: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  mutableMetadata: boolean | null;
  creator: string | null;
  creatorBalanceRaw: number | null;
  topHolders: SecurityHolder[];
  top10Pct: number | null;
  top20Pct: number | null;
  holderSampleCount: number;
  totalMarketLiquidity: number | null;
  rugcheckScoreNormalized: number | null;
  risks: SecurityRisk[];
  dangerRiskCount: number;
  warnRiskCount: number;
  criticalFlags: string[];
  source: 'rugcheck';
  fetchedAt: string;
};

const CRITICAL_RISK_NAME_RE =
  /honeypot|rug|scam|freeze|mint authority|hidden owner|proxy|blacklist|cant sell|can't sell|transfer hook/i;

function sumPct(holders: SecurityHolder[], n: number): number | null {
  if (holders.length === 0) return null;
  return holders.slice(0, n).reduce((acc, h) => acc + (h.pct || 0), 0);
}

export function mapRugcheckReport(
  address: string,
  payload: Record<string, unknown>,
): TokenSecurityReport {
  const token = (payload.token ?? {}) as Record<string, unknown>;
  const tokenMeta = (payload.tokenMeta ?? {}) as Record<string, unknown>;

  const mintAuthority =
    (payload.mintAuthority as string | null | undefined) ??
    (token.mintAuthority as string | null | undefined) ??
    null;
  const freezeAuthority =
    (payload.freezeAuthority as string | null | undefined) ??
    (token.freezeAuthority as string | null | undefined) ??
    null;

  const rawHolders = Array.isArray(payload.topHolders)
    ? (payload.topHolders as Array<Record<string, unknown>>)
    : [];
  const topHolders: SecurityHolder[] = rawHolders.map((h) => ({
    address: String(h.address ?? ''),
    owner: h.owner ? String(h.owner) : undefined,
    pct: num(h.pct) ?? 0,
    insider: Boolean(h.insider),
  }));

  const risksRaw = Array.isArray(payload.risks)
    ? (payload.risks as Array<Record<string, unknown>>)
    : [];
  const risks: SecurityRisk[] = risksRaw.map((r) => ({
    name: String(r.name ?? 'Unknown risk'),
    level: String(r.level ?? 'unknown').toLowerCase(),
    score: num(r.score),
    description: r.description ? String(r.description) : undefined,
  }));

  const dangerRiskCount = risks.filter((r) => r.level === 'danger').length;
  const warnRiskCount = risks.filter((r) => r.level === 'warn' || r.level === 'warning').length;

  const criticalFlags: string[] = [];
  if (mintAuthority) criticalFlags.push('Mint authority is still active');
  if (freezeAuthority) criticalFlags.push('Freeze authority is still active');
  for (const risk of risks) {
    if (risk.level === 'critical' || CRITICAL_RISK_NAME_RE.test(risk.name)) {
      criticalFlags.push(`Security provider: ${risk.name}`);
    }
  }

  return {
    address,
    mintAuthority,
    freezeAuthority,
    mintAuthorityRevoked: mintAuthority == null,
    freezeAuthorityRevoked: freezeAuthority == null,
    mutableMetadata:
      typeof tokenMeta.mutable === 'boolean' ? tokenMeta.mutable : null,
    creator: payload.creator ? String(payload.creator) : null,
    creatorBalanceRaw: num(payload.creatorBalance),
    topHolders,
    top10Pct: sumPct(topHolders, 10),
    top20Pct: sumPct(topHolders, 20),
    holderSampleCount: topHolders.length,
    totalMarketLiquidity: num(payload.totalMarketLiquidity),
    rugcheckScoreNormalized: num(payload.score_normalised),
    risks,
    dangerRiskCount,
    warnRiskCount,
    criticalFlags: [...new Set(criticalFlags)],
    source: 'rugcheck',
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchTokenSecurityReport(
  address: string,
): Promise<ProviderResult<TokenSecurityReport>> {
  try {
    const url = `${baseUrl()}/tokens/${encodeURIComponent(address)}/report`;
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) {
      return {
        ok: false,
        unavailable: res.status >= 500 || res.status === 429,
        error: `Token security HTTP ${res.status}`,
      };
    }
    const payload = (await res.json()) as Record<string, unknown>;
    return { ok: true, data: mapRugcheckReport(address, payload) };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Token security request failed',
    };
  }
}

export async function pingTokenSecurity(): Promise<SourceHealth> {
  const started = Date.now();
  try {
    // Lightweight ping via known mint report
    const url = `${baseUrl()}/tokens/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263/report`;
    const res = await fetchWithTimeout(url, {}, 5000);
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { status: 'OFFLINE', message: `HTTP ${res.status}`, latencyMs };
    }
    return { status: 'ONLINE', latencyMs };
  } catch (err) {
    return {
      status: 'OFFLINE',
      message: err instanceof Error ? err.message : 'unreachable',
    };
  }
}
