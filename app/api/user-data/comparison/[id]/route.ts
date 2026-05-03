import { NextResponse } from 'next/server';
import { deleteComparison } from '@/lib/user-data-db';

function validVisitorId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const visitorId = new URL(request.url).searchParams.get('visitorId');
  const { id } = await params;
  if (!validVisitorId(visitorId) || !id) {
    return NextResponse.json({ ok: false, message: '收益对比删除参数无效。' }, { status: 400 });
  }

  deleteComparison(visitorId, id);
  return NextResponse.json({ ok: true });
}
