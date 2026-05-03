import { NextResponse } from 'next/server';
import { syncComparisons, upsertComparison } from '@/lib/user-data-db';
import type { ComparisonItem } from '@/lib/types';

function validVisitorId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
}

function validNumber(value: unknown) {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));
}

function validComparisonItem(value: unknown): value is ComparisonItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ComparisonItem>;
  const returns = (item.returns ?? {}) as Partial<ComparisonItem['returns']>;
  return (
    typeof item.id === 'string' &&
    (item.assetType === 'fund' || item.assetType === 'stock') &&
    typeof item.code === 'string' &&
    /^\d{6}$/.test(item.code) &&
    typeof item.name === 'string' &&
    validNumber(item.latestPrice) &&
    typeof item.returns === 'object' &&
    item.returns !== null &&
    validNumber(returns.day1) &&
    validNumber(returns.week1) &&
    validNumber(returns.month1) &&
    validNumber(returns.month3) &&
    validNumber(returns.month6) &&
    validNumber(returns.year1) &&
    typeof item.updatedAt === 'string'
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as { visitorId?: unknown; item?: unknown };
  if (!validVisitorId(body.visitorId) || !validComparisonItem(body.item)) {
    return NextResponse.json({ ok: false, message: '收益对比参数无效。' }, { status: 400 });
  }

  upsertComparison(body.visitorId, body.item);
  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as { visitorId?: unknown; items?: unknown };
  if (!validVisitorId(body.visitorId) || !Array.isArray(body.items) || !body.items.every(validComparisonItem)) {
    return NextResponse.json({ ok: false, message: '收益对比更新参数无效。' }, { status: 400 });
  }

  syncComparisons(body.visitorId, body.items);
  return NextResponse.json({ ok: true });
}
