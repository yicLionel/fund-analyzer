import { NextResponse } from 'next/server';
import { createDecision, updateDecision } from '@/lib/user-data-db';
import type { DecisionItem } from '@/lib/types';

function validVisitorId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
}

function validDecisionItem(value: unknown): value is DecisionItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DecisionItem>;
  return (
    typeof item.id === 'string' &&
    (item.assetType === 'fund' || item.assetType === 'stock') &&
    typeof item.code === 'string' &&
    /^\d{6}$/.test(item.code) &&
    typeof item.name === 'string' &&
    typeof item.buyPrice === 'number' &&
    Number.isFinite(item.buyPrice) &&
    typeof item.buyDate === 'string' &&
    typeof item.createdAt === 'string'
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as { visitorId?: unknown; item?: unknown };
  if (!validVisitorId(body.visitorId) || !validDecisionItem(body.item)) {
    return NextResponse.json({ ok: false, message: '买入决策参数无效。' }, { status: 400 });
  }

  createDecision(body.visitorId, body.item);
  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as { visitorId?: unknown; items?: unknown };
  if (!validVisitorId(body.visitorId) || !Array.isArray(body.items) || !body.items.every(validDecisionItem)) {
    return NextResponse.json({ ok: false, message: '买入决策更新参数无效。' }, { status: 400 });
  }

  for (const item of body.items) {
    updateDecision(body.visitorId, item);
  }
  return NextResponse.json({ ok: true });
}
