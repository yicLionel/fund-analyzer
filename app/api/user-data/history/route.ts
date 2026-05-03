import { NextResponse } from 'next/server';
import { clearHistories, upsertHistory } from '@/lib/user-data-db';
import type { HistoryItem } from '@/lib/types';

function validVisitorId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
}

function validHistoryItem(value: unknown): value is HistoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<HistoryItem>;
  return (
    (item.assetType === 'fund' || item.assetType === 'stock') &&
    typeof item.code === 'string' &&
    /^\d{6}$/.test(item.code) &&
    typeof item.name === 'string' &&
    typeof item.viewedAt === 'string'
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as { visitorId?: unknown; item?: unknown };
  if (!validVisitorId(body.visitorId) || !validHistoryItem(body.item)) {
    return NextResponse.json({ ok: false, message: '历史记录参数无效。' }, { status: 400 });
  }

  await upsertHistory(body.visitorId, body.item);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const visitorId = new URL(request.url).searchParams.get('visitorId');
  if (!validVisitorId(visitorId)) {
    return NextResponse.json({ ok: false, message: '缺少有效的 visitorId。' }, { status: 400 });
  }

  await clearHistories(visitorId);
  return NextResponse.json({ ok: true });
}
