import { DEFAULT_FOREX_RISK, type CalendarEvent, type PairSpec, type SessionName, type SessionSnapshot } from './types';
import { pairCurrencies } from './pairs';

const FOMC_2026 = [
  '2026-01-28',
  '2026-03-18',
  '2026-04-29',
  '2026-06-17',
  '2026-07-29',
  '2026-09-16',
  '2026-10-28',
  '2026-12-09',
];

const ECB_2026 = [
  '2026-01-22',
  '2026-03-05',
  '2026-04-16',
  '2026-06-04',
  '2026-07-23',
  '2026-09-10',
  '2026-10-29',
  '2026-12-17',
];

const BOE_2026 = [
  '2026-02-05',
  '2026-03-19',
  '2026-05-07',
  '2026-06-18',
  '2026-08-06',
  '2026-09-17',
  '2026-11-05',
  '2026-12-17',
];

export function usEasternOffsetHours(at: Date): number {
  const y = at.getUTCFullYear();
  const dstStart = nthWeekdayOfMonth(y, 2, 0, 2);
  const dstEnd = nthWeekdayOfMonth(y, 10, 0, 1);
  const utc = at.getTime();
  const start = Date.UTC(y, 2, dstStart, 7);
  const end = Date.UTC(y, 10, dstEnd, 6);
  return utc >= start && utc < end ? 4 : 5;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(year, month, d));
    if (dt.getUTCMonth() !== month) break;
    if (dt.getUTCDay() === weekday) {
      count += 1;
      if (count === n) return d;
    }
  }
  return 1;
}

function firstFriday(year: number, month: number): number {
  for (let d = 1; d <= 7; d++) {
    if (new Date(Date.UTC(year, month, d)).getUTCDay() === 5) return d;
  }
  return 1;
}

function weekdayOnOrBefore(year: number, month: number, day: number): number {
  const dt = new Date(Date.UTC(year, month, day));
  const wd = dt.getUTCDay();
  if (wd === 0) return day - 2;
  if (wd === 6) return day - 1;
  return day;
}

function eventWindow(
  id: string,
  name: string,
  currency: string,
  impact: CalendarEvent['impact'],
  startUtc: Date,
  minutes: number,
): CalendarEvent {
  const pad = DEFAULT_FOREX_RISK.newsBlackoutMinutes;
  const starts = new Date(startUtc.getTime() - pad * 60_000);
  const ends = new Date(startUtc.getTime() + minutes * 60_000 + pad * 60_000);
  return {
    id,
    name,
    currency,
    impact,
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
  };
}

export function highImpactEvents(from: Date, to: Date): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const startY = from.getUTCFullYear();
  const endY = to.getUTCFullYear();
  for (let y = startY; y <= endY; y++) {
    for (let m = 0; m < 12; m++) {
      const nfpDay = firstFriday(y, m);
      const nfp = new Date(Date.UTC(y, m, nfpDay, 12, 30));
      nfp.setUTCHours(12 + (usEasternOffsetHours(nfp) === 4 ? 0 : 1), 30, 0, 0);
      out.push(eventWindow(`nfp-${y}-${m + 1}`, 'US NFP', 'USD', 'HIGH', nfp, 15));

      const cpiDay = weekdayOnOrBefore(y, m, 13);
      const cpi = new Date(Date.UTC(y, m, cpiDay, 12, 30));
      cpi.setUTCHours(12 + (usEasternOffsetHours(cpi) === 4 ? 0 : 1), 30, 0, 0);
      out.push(eventWindow(`cpi-${y}-${m + 1}`, 'US CPI', 'USD', 'HIGH', cpi, 15));
    }
    for (const day of y === 2026 ? FOMC_2026 : []) {
      const d = new Date(`${day}T18:00:00Z`);
      d.setUTCHours(14 + usEasternOffsetHours(d), 0, 0, 0);
      out.push(eventWindow(`fomc-${day}`, 'FOMC rate decision', 'USD', 'HIGH', d, 60));
    }
    for (const day of y === 2026 ? ECB_2026 : []) {
      out.push(eventWindow(`ecb-${day}`, 'ECB rate decision', 'EUR', 'HIGH', new Date(`${day}T12:15:00Z`), 75));
    }
    for (const day of y === 2026 ? BOE_2026 : []) {
      out.push(eventWindow(`boe-${day}`, 'BoE rate decision', 'GBP', 'HIGH', new Date(`${day}T11:00:00Z`), 60));
    }
  }
  return out.filter((e) => e.endsAt >= from.toISOString() && e.startsAt <= to.toISOString());
}

export function activeBlackouts(at: Date, spec?: PairSpec): CalendarEvent[] {
  const windowStart = new Date(at.getTime() - 2 * 86400_000);
  const windowEnd = new Date(at.getTime() + 2 * 86400_000);
  const iso = at.toISOString();
  const currencies = spec ? new Set(pairCurrencies(spec)) : null;
  return highImpactEvents(windowStart, windowEnd).filter((e) => {
    if (iso < e.startsAt || iso > e.endsAt) return false;
    if (!currencies) return true;
    return currencies.has(e.currency) || e.currency === 'USD';
  });
}

export function sessionSnapshot(at: Date): SessionSnapshot {
  const day = at.getUTCDay();
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  const forexOpen = !(day === 6 || (day === 5 && minutes >= 22 * 60) || (day === 0 && minutes < 22 * 60));
  const rollover = forexOpen && at.getUTCHours() === DEFAULT_FOREX_RISK.rolloverUtcHour;
  const sundayOpenProtect =
    day === 0 && minutes >= 22 * 60 && minutes < 22 * 60 + DEFAULT_FOREX_RISK.sessionOpenProtectMinutes;
  const fridayCloseProtect = day === 5 && minutes >= 21 * 60;
  const name = currentSession(minutes, forexOpen);
  const sessionOpenProtect = isSessionOpenProtect(minutes) || sundayOpenProtect;
  const notes: string[] = [];
  if (!forexOpen) notes.push('Spot FX weekend close');
  if (rollover) notes.push('Daily rollover window (21:00–22:00 UTC) — new entries blocked');
  if (sessionOpenProtect) notes.push('Session open protection — spread/gap risk');
  if (fridayCloseProtect) notes.push('Friday close protection — weekend gap risk');
  return {
    name,
    forexOpen,
    rollover,
    sessionOpenProtect,
    fridayCloseProtect,
    sundayOpenProtect,
    note: notes.join(' · ') || `${name} session`,
  };
}

function currentSession(minutes: number, forexOpen: boolean): SessionName {
  if (!forexOpen) return 'CLOSED';
  if (minutes >= 12 * 60 && minutes < 21 * 60) return 'NEW_YORK';
  if (minutes >= 7 * 60 && minutes < 16 * 60) return 'LONDON';
  if (minutes >= 0 && minutes < 9 * 60) return 'TOKYO';
  return 'SYDNEY';
}

function isSessionOpenProtect(minutes: number): boolean {
  const opens = [0, 7 * 60, 12 * 60, 22 * 60];
  const pad = DEFAULT_FOREX_RISK.sessionOpenProtectMinutes;
  return opens.some((o) => minutes >= o && minutes < o + pad);
}

export function filterReasonsForTime(at: Date, spec: PairSpec): string[] {
  const reasons: string[] = [];
  const session = sessionSnapshot(at);
  if (!session.forexOpen) reasons.push('Market closed');
  if (session.rollover) reasons.push('Rollover protection');
  if (session.sessionOpenProtect) reasons.push('Session-open protection');
  if (session.fridayCloseProtect) reasons.push('Friday-close / weekend-gap protection');
  const news = activeBlackouts(at, spec);
  for (const e of news) reasons.push(`News blackout: ${e.name} (${e.currency})`);
  return reasons;
}
