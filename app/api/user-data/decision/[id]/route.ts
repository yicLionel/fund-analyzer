import { NextResponse } from 'next/server';
import { deleteDecision } from '@/lib/user-data-db';

function validVisitorId(value: string | null): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{12,80}$/.test(value));
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const visitorId = new URL(request.url).searchParams.get('visitorId');
  const { id } = await context.params;
  if (!validVisitorId(visitorId) || !id) {
    return NextResponse.json({ ok: false, message: '删除参数无效。' }, { status: 400 });
  }

  await deleteDecision(visitorId, id);
  return NextResponse.json({ ok: true });
}
