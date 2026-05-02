import { NextResponse } from 'next/server';
import { fetchStockAnalysis } from '@/lib/provider-eastmoney-stock';

export async function GET(
  _: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json(
      {
        ok: false,
        message: '股票代码格式无效，请输入 6 位 A 股代码。',
      },
      { status: 400 }
    );
  }

  const data = await fetchStockAnalysis(code);
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
    },
  });
}
