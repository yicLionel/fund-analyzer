import type { NavPoint, ReturnStats } from './types';

const EMPTY_RETURNS: ReturnStats = {
  day1: null,
  week1: null,
  month1: null,
  month3: null,
  month6: null,
  year1: null,
};

function pct(latest: number, base: number): number | null {
  return base === 0 ? null : ((latest - base) / base) * 100;
}

function parseDate(date: string): Date | null {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function subtractMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() - months;
  const targetMonthStart = new Date(Date.UTC(year, month, 1));
  const targetYear = targetMonthStart.getUTCFullYear();
  const targetMonth = targetMonthStart.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(date.getUTCDate(), lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, targetDay));
}

function findOnOrBefore(series: NavPoint[], targetDate: Date): NavPoint | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const current = parseDate(series[i].date);
    if (current && current.getTime() <= targetDate.getTime()) return series[i];
  }
  return null;
}

export function buildCalendarReturnStats(series: NavPoint[]): ReturnStats {
  const latestPoint = series.at(-1);
  const latestDate = latestPoint ? parseDate(latestPoint.date) : null;
  if (!latestPoint || !latestDate || !latestPoint.nav) return { ...EMPTY_RETURNS };

  const byTargetDate = (targetDate: Date) => {
    const basePoint = findOnOrBefore(series, targetDate);
    return basePoint ? pct(latestPoint.nav, basePoint.nav) : null;
  };

  return {
    day1: series.length >= 2 ? pct(latestPoint.nav, series[series.length - 2].nav) : null,
    week1: byTargetDate(subtractDays(latestDate, 7)),
    month1: byTargetDate(subtractMonths(latestDate, 1)),
    month3: byTargetDate(subtractMonths(latestDate, 3)),
    month6: byTargetDate(subtractMonths(latestDate, 6)),
    year1: byTargetDate(subtractMonths(latestDate, 12)),
  };
}
