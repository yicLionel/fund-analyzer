import { NextResponse } from 'next/server';
import { getUserData } from '@/lib/user-data-db';

function validVisitorId(value: string | null): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{12,80}$/.test(value));
}

export async function GET(request: Request) {
  const visitorId = new URL(request.url).searchParams.get('visitorId');
  if (!validVisitorId(visitorId)) {
    return NextResponse.json({ ok: false, message: '缺少有效的 visitorId。' }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    ...(await getUserData(visitorId)),
  });
}
