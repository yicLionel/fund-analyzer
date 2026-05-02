import { NextResponse } from 'next/server';
import { fetchFundAnalysis } from '@/lib/provider-eastmoney';

export async function GET(
  _: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json(
      {
        ok: false,
        message: '基金代码格式无效，请输入 6 位数字代码。',
      },
      { status: 400 }
    );
  }

  const data = await fetchFundAnalysis(code);
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
    },
  });
}
