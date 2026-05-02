import { buildAnalysis } from './analysis';
import { buildBacktest } from './backtest';
import type {
  BenchmarkSeries,
  IndexSnapshot,
  NavPoint,
  RangeKey,
  SourceItem,
  StockAnalysisResponse,
  StockBasicInfo,
} from './types';

const SOURCES: SourceItem[] = [
  {
    name: '东方财富 A 股日 K 线接口',
    desc: '用于股票名称、复权收盘价、成交量、成交额和历史日线序列。',
  },
  {
    name: '东方财富指数日 K 线接口',
    desc: '用于沪深300、中证500、创业板指等基准指数历史收盘价和回测超额收益验证。',
  },
];

const INDEX_DEFINITIONS = [
  { code: '000300', name: '沪深300', secid: '1.000300' },
  { code: '000905', name: '中证500', secid: '1.000905' },
  { code: '399006', name: '创业板指', secid: '0.399006' },
];

const RANGE_DAYS: Record<RangeKey, number> = {
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

interface EastmoneyKlineResponse {
  rc: number;
  data?: {
    code?: string;
    market?: number;
    name?: string;
    klines?: string[];
  };
}

interface ParsedKline {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
}

function pct(a: number, b: number): number {
  return b === 0 ? 0 : ((a - b) / b) * 100;
}

function parseNumber(input: string | undefined): number | null {
  if (!input) return null;
  const value = Number(input.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 StockAnalyzer/1.0',
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://quote.eastmoney.com/',
    },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`请求失败: ${res.status}`);
  return await res.text();
}

function inferStockSecid(code: string): { secid: string; market: StockBasicInfo['market'] } {
  if (code.startsWith('6')) return { secid: `1.${code}`, market: 'SH' };
  if (code.startsWith('0') || code.startsWith('3')) return { secid: `0.${code}`, market: 'SZ' };
  return { secid: `0.${code}`, market: 'UNKNOWN' };
}

function parseKline(line: string): ParsedKline | null {
  const [date, open, close, high, low, volume, amount] = line.split(',');
  const parsed = {
    date,
    open: parseNumber(open),
    close: parseNumber(close),
    high: parseNumber(high),
    low: parseNumber(low),
    volume: parseNumber(volume),
    amount: parseNumber(amount),
  };
  if (
    !parsed.date ||
    parsed.open === null ||
    parsed.close === null ||
    parsed.high === null ||
    parsed.low === null ||
    parsed.volume === null ||
    parsed.amount === null
  ) {
    return null;
  }
  return parsed as ParsedKline;
}

async function getKlineSeries(secid: string, begin = '19900101', end = '20500101'): Promise<EastmoneyKlineResponse> {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.searchParams.set('secid', secid);
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
  url.searchParams.set('klt', '101');
  url.searchParams.set('fqt', '1');
  url.searchParams.set('beg', begin);
  url.searchParams.set('end', end);

  return JSON.parse(await fetchText(url.toString())) as EastmoneyKlineResponse;
}

function buildReturnStats(series: NavPoint[]) {
  const latest = series.at(-1)?.nav;
  if (!latest) {
    return { day1: null, week1: null, month1: null, month3: null, month6: null, year1: null };
  }
  const pick = (offset: number) => {
    const idx = series.length - 1 - offset;
    if (idx < 0) return null;
    const base = series[idx].nav;
    return base ? pct(latest, base) : null;
  };
  return {
    day1: pick(1),
    week1: pick(5),
    month1: pick(21),
    month3: pick(63),
    month6: pick(126),
    year1: pick(252),
  };
}

function sliceSeriesByDays(series: NavPoint[], days: number): NavPoint[] {
  if (!series.length) return [];
  const end = new Date(series[series.length - 1].date).getTime();
  const start = end - days * 24 * 60 * 60 * 1000;
  return series.filter((p) => new Date(p.date).getTime() >= start);
}

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

async function getBenchmarkSeries(
  definition: (typeof INDEX_DEFINITIONS)[number],
  startDate: string,
  endDate: string
): Promise<BenchmarkSeries> {
  const response = await getKlineSeries(definition.secid, compactDate(startDate), compactDate(endDate));
  if (response.rc !== 0 || !response.data?.klines?.length) {
    throw new Error(`未获取到${definition.name}历史指数序列`);
  }
  const points = response.data.klines
    .map(parseKline)
    .filter((item): item is ParsedKline => item !== null)
    .map((item) => ({ date: item.date, close: item.close }));

  return {
    code: response.data.code ?? definition.code,
    name: response.data.name ?? definition.name,
    dataDate: points.at(-1)?.date ?? null,
    points,
  };
}

async function getBenchmarkSeriesList(series: NavPoint[]): Promise<BenchmarkSeries[]> {
  const startDate = series[0]?.date;
  const endDate = series.at(-1)?.date;
  if (!startDate || !endDate) return [];

  const results = await Promise.allSettled(
    INDEX_DEFINITIONS.map((definition) => getBenchmarkSeries(definition, startDate, endDate))
  );
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

function benchmarkSnapshot(benchmark: BenchmarkSeries): IndexSnapshot {
  const latest = benchmark.points.at(-1);
  const prev = benchmark.points.at(-2);
  return {
    code: benchmark.code,
    name: benchmark.name,
    date: latest?.date ?? benchmark.dataDate,
    close: latest?.close ?? null,
    changePct: latest && prev ? pct(latest.close, prev.close) : null,
  };
}

function buildIndexSnapshots(benchmarks: BenchmarkSeries[]): IndexSnapshot[] {
  return INDEX_DEFINITIONS.map((definition) => {
    const benchmark = benchmarks.find((item) => item.code === definition.code);
    return benchmark ? benchmarkSnapshot(benchmark) : { code: definition.code, name: definition.name, date: null, close: null, changePct: null };
  });
}

function alignBenchmarkForChart(series: NavPoint[], benchmark?: BenchmarkSeries | null): NavPoint[] {
  if (!benchmark?.points.length || !series.length) return series;

  const benchmarkByDate = new Map(benchmark.points.map((point) => [point.date, point.close]));
  const firstMatched = series.find((point) => benchmarkByDate.has(point.date));
  if (!firstMatched) return series;

  const baseBenchmark = benchmarkByDate.get(firstMatched.date);
  if (!baseBenchmark) return series;

  return series.map((point) => {
    const close = benchmarkByDate.get(point.date);
    return close ? { ...point, benchmark: (close / baseBenchmark) * firstMatched.nav } : point;
  });
}

function emptyResponse(code: string, message: string): StockAnalysisResponse {
  return {
    ok: false,
    code,
    dataDate: null,
    updatedAt: new Date().toISOString(),
    basic: null,
    series: { '1m': [], '3m': [], '6m': [], '1y': [] },
    compareIndex: [],
    primaryBenchmark: null,
    analysis: {
      shortTerm: { label: '无法判断', confidence: '低', score: 0 },
      midTerm: { label: '无法判断', confidence: '低', score: 0 },
      coreReasons: ['接口异常、公开数据结构变化或股票代码无效。'],
      riskFactors: ['当前数据不足，无法给出可靠判断。'],
      indicatorSnapshot: {},
      disclaimer: '本接口仅提供基于公开数据的辅助分析，不构成投资建议。',
      degraded: true,
      degradedReason: '当前数据不足，无法给出可靠判断。',
    },
    sources: SOURCES,
    message,
  };
}

export async function fetchStockAnalysis(code: string): Promise<StockAnalysisResponse> {
  const normalizedCode = code.trim();
  const inferred = inferStockSecid(normalizedCode);

  try {
    const response = await getKlineSeries(inferred.secid);
    if (response.rc !== 0 || !response.data?.klines?.length) {
      return emptyResponse(normalizedCode, '未获取到该股票历史行情，请检查 A 股代码是否正确。');
    }

    const klines = response.data.klines.map(parseKline).filter((item): item is ParsedKline => item !== null);
    const fullSeries = klines.map((item) => ({ date: item.date, nav: item.close }));
    if (fullSeries.length < 20) {
      return emptyResponse(normalizedCode, '历史行情样本不足，无法生成稳定预测信号。');
    }

    const benchmarks = await getBenchmarkSeriesList(fullSeries);
    const compareIndex = buildIndexSnapshots(benchmarks);
    const primaryBenchmark = benchmarks.find((item) => item.code === '000300') ?? null;
    const latest = klines.at(-1);

    const basic: StockBasicInfo = {
      code: response.data.code ?? normalizedCode,
      name: response.data.name ?? normalizedCode,
      market: inferred.market,
      latestClose: latest?.close ?? null,
      latestDate: latest?.date ?? null,
      latestVolume: latest?.volume ?? null,
      latestAmount: latest?.amount ?? null,
      returns: buildReturnStats(fullSeries),
    };

    const rawSeriesMap = {
      '1m': sliceSeriesByDays(fullSeries, RANGE_DAYS['1m']),
      '3m': sliceSeriesByDays(fullSeries, RANGE_DAYS['3m']),
      '6m': sliceSeriesByDays(fullSeries, RANGE_DAYS['6m']),
      '1y': sliceSeriesByDays(fullSeries, RANGE_DAYS['1y']),
    };
    const series = {
      '1m': alignBenchmarkForChart(rawSeriesMap['1m'], primaryBenchmark),
      '3m': alignBenchmarkForChart(rawSeriesMap['3m'], primaryBenchmark),
      '6m': alignBenchmarkForChart(rawSeriesMap['6m'], primaryBenchmark),
      '1y': alignBenchmarkForChart(rawSeriesMap['1y'], primaryBenchmark),
    };
    const analysis = buildAnalysis(rawSeriesMap['1y'].length >= 20 ? rawSeriesMap['1y'] : fullSeries);
    const backtest = buildBacktest(fullSeries, primaryBenchmark, 30);

    return {
      ok: true,
      code: normalizedCode,
      dataDate: basic.latestDate ?? fullSeries.at(-1)?.date ?? null,
      updatedAt: new Date().toISOString(),
      basic,
      series,
      compareIndex,
      primaryBenchmark: primaryBenchmark ? benchmarkSnapshot(primaryBenchmark) : null,
      analysis: {
        ...analysis,
        disclaimer: '本接口仅基于公开行情做规则信号与历史回测验证，不构成投资建议；股票价格波动与个股事件风险较高。',
      },
      backtest,
      sources: SOURCES,
    };
  } catch (error) {
    return emptyResponse(normalizedCode, error instanceof Error ? error.message : '未知错误');
  }
}
