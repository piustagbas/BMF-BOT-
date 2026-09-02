import { fetchWithTimeout } from '@memecoinbot/data-providers';
import type { ProviderHealth, FootballProviderName } from './football-data.types';

export const DEFAULT_FOOTBALL_TIMEZONE = 'Africa/Lagos';

export function footballTimezone(): string {
  const configured = process.env.FOOTBALL_TIMEZONE?.trim();
  if (!configured) return DEFAULT_FOOTBALL_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured }).format();
    return configured;
  } catch {
    return DEFAULT_FOOTBALL_TIMEZONE;
  }
}

export function validYmd(value: string | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

export function toUtcIso(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const timestamp = typeof value === 'number' ? value * (value < 10_000_000_000 ? 1000 : 1) : Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

export function localDate(value: string, timezone = footballTimezone()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

export function localDay(value: string, timezone = footballTimezone()): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(new Date(value)).toLowerCase();
}

export function localDateTime(value: string, timezone = footballTimezone()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function dateRangeForQuery(input: {
  date?: string;
  day?: string;
  timezone?: string;
  now?: Date;
}): { dateFrom?: string; dateTo?: string; timezone: string } {
  const timezone = input.timezone?.trim() || footballTimezone();
  if (validYmd(input.date)) return { dateFrom: input.date, dateTo: input.date, timezone };
  const requestedDay = input.day?.trim().toLowerCase();
  if (!requestedDay || requestedDay === 'all' || requestedDay === 'all days') return { timezone };
  const now = input.now ?? new Date();
  if (requestedDay === 'today' || requestedDay === 'tomorrow') {
    const targetDate = new Date(now.getTime() + (requestedDay === 'tomorrow' ? 86_400_000 : 0));
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(targetDate);
    return { dateFrom: ymd, dateTo: ymd, timezone };
  }
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const target = names.indexOf(requestedDay);
  if (target < 0) return { timezone };
  const currentName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(now).toLowerCase();
  const current = names.indexOf(currentName);
  const offset = (target - current + 7) % 7;
  const targetDate = new Date(now.getTime() + offset * 86_400_000);
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(targetDate);
  return { dateFrom: ymd, dateTo: ymd, timezone };
}

export function emptyProviderResult(provider: FootballProviderName, configured: boolean, message?: string) {
  const health: ProviderHealth = {
    provider,
    status: configured ? 'error' : 'disabled',
    responseTimeMs: null,
    errors: configured ? 1 : 0,
    rateLimitResponses: 0,
    lastSuccessfulSync: null,
    fixturesReceived: 0,
    message: message || (configured ? 'Provider unavailable' : 'Provider key not configured'),
  };
  return {
    provider,
    fixtures: [],
    results: [],
    leagues: [],
    standings: [],
    teamStatistics: [],
    fixtureStatistics: [],
    headToHeads: [],
    odds: [],
    health,
    warning: health.message,
  };
}

export async function getJson(url: string, init: RequestInit, timeoutMs = 12000): Promise<{
  response: Response;
  body: unknown;
  elapsedMs: number;
}> {
  const started = Date.now();
  const response = await fetchWithTimeout(url, init, timeoutMs);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { response, body, elapsedMs: Date.now() - started };
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function sourceId(provider: FootballProviderName, id: unknown): string | undefined {
  const value = typeof id === 'number' ? String(id) : stringValue(id);
  return value ? `${provider}:${value}` : undefined;
}
