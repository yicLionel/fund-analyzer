import { buildAnalysis } from './analysis';
import { buildBacktest } from './backtest';
import type { BenchmarkSeries, FundAnalysisResponse, FundBasicInfo, IndexSnapshot, NavPoint, RangeKey, SourceItem } from './types';

const SOURCES: SourceItem[] = [
  {
    name: '东方财富 / 天天基金公开页面',
    desc: '用于基金名称、基金类型、成立日期、基金公司、基金经理、最新单位净值、阶段涨幅、历史净值等公开信息。',
  },
  {
    name: '中证指数有限公司公开资料',
    desc: '用于沪深300等指数的公开说明与基准含义对照。',
  },
  {
    name: '东方财富指数日 K 线接口',
    desc: '用于沪深300、中证500、创业板指等基准指数历史收盘价、走势图归一化叠加与回测超额收益验证。',
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

function parseNumber(input: string | undefined | null): number | null {
  if (!input) return null;
  const clean = input.replace(/,/g, '').replace(/%/g, '').trim();
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function pct(a: number, b: number): number {
  return b === 0 ? 0 : ((a - b) / b) * 100;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 FundAnalyzer/1.0',
      Accept: 'text/html,application/json,text/plain,*/*',
      Referer: 'https://fund.eastmoney.com/',
    },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`请求失败: ${res.status}`);
  return await res.text();
}

function extractAssignedString(page: string, key: string): string | null {
  const reg = new RegExp(`${key}\\s*=\\s*"([^"]*)"`);
  return page.match(reg)?.[1] ?? null;
}

function decodeHtml(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function cleanHtmlText(input: string | undefined | null): string | null {
  if (!input) return null;
  const text = decodeHtml(input)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[：:\s]+|[：:\s]+$/g, '')
    .trim();

  if (!text || text === '--' || text === '---') return null;
  return text;
}

function normalizeDate(input: string | undefined | null): string | null {
  if (!input) return null;
  const match = input.match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function extractLabelValue(pageHtml: string, label: string): string | null {
  const reg = new RegExp(`<label[^>]*>\\s*${label}\\s*[：:]([\\s\\S]*?)<\\/label>`, 'i');
  return cleanHtmlText(pageHtml.match(reg)?.[1]);
}

function extractTableValue(pageHtml: string, label: string): string | null {
  const reg = new RegExp(`<th[^>]*>\\s*${label}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)(?=<th|<\\/td>|<\\/tr>)`, 'i');
  return cleanHtmlText(pageHtml.match(reg)?.[1]);
}

function extractProfileValue(pageHtml: string, labels: string[]): string | null {
  for (const label of labels) {
    const value = extractLabelValue(pageHtml, label) ?? extractTableValue(pageHtml, label);
    if (value) return value;
  }
  return null;
}

function normalizeBasicInfo(pageHtml: string, rawInfo: Pick<FundBasicInfo, 'code' | 'name' | 'latestNav' | 'latestNavDate'>): FundBasicInfo {
  const text = cleanHtmlText(pageHtml) ?? '';
  const type = extractProfileValue(pageHtml, ['类型', '基金类型']);
  const company = extractProfileValue(pageHtml, ['管理人', '基金管理人']);
  const manager = extractProfileValue(pageHtml, ['基金经理', '基金经理人'])?.replace(/\s+/g, '、') ?? null;
  const establishDate = normalizeDate(extractProfileValue(pageHtml, ['成立日期', '成立日期/规模']));
  const nav = parseNumber(text.match(/单位净值[^\d]*([0-9]+\.[0-9]+)/i)?.[1] ?? null);

  return {
    code: rawInfo.code,
    name: rawInfo.name,
    type,
    establishDate,
    company,
    manager,
    latestNav: nav ?? rawInfo.latestNav ?? null,
    latestNavDate: rawInfo.latestNavDate ?? null,
    returns: {
      day1: null,
      week1: null,
      month1: null,
      month3: null,
      month6: null,
      year1: null,
    },
  };
}

async function getFundProfilePage(code: string): Promise<string> {
  return fetchText(`https://fund.eastmoney.com/f10/jbgk_${code}.html`);
}

async function getNavSeries(code: string): Promise<NavPoint[]> {
  const page = await fetchText(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`);
  if (page.includes('jsonpgz') && !page.includes('Data_netWorthTrend')) {
    throw new Error('基金代码无效或公开数据不存在');
  }
  const match = page.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('未获取到历史净值序列');
  const parsed = JSON.parse(match[1]) as Array<{ x: number; y: number }>;
  return parsed
    .map((item) => ({ date: new Date(item.x).toISOString().slice(0, 10), nav: Number(item.y) }))
    .filter((item) => Number.isFinite(item.nav));
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
    return base ? ((latest - base) / base) * 100 : null;
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

async function getRawBasicInfo(code: string, series: NavPoint[]): Promise<Pick<FundBasicInfo, 'code' | 'name' | 'latestNav' | 'latestNavDate'>> {
  const page = await fetchText(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`);
  const name = extractAssignedString(page, 'fS_name') || extractAssignedString(page, 'fS_name_abbr') || code;
  return {
    code,
    name,
    latestNav: series.at(-1)?.nav ?? null,
    latestNavDate: series.at(-1)?.date ?? null,
  };
}

async function getIndexSnapshots(): Promise<IndexSnapshot[]> {
  return INDEX_DEFINITIONS.map(({ code, name }) => ({ code, name, date: null, changePct: null }));
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
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.searchParams.set('secid', definition.secid);
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
  url.searchParams.set('klt', '101');
  url.searchParams.set('fqt', '1');
  url.searchParams.set('beg', compactDate(startDate));
  url.searchParams.set('end', compactDate(endDate));

  const page = await fetchText(url.toString());
  const parsed = JSON.parse(page) as {
    rc: number;
    data?: { code?: string; name?: string; klines?: string[] };
  };
  if (parsed.rc !== 0 || !parsed.data?.klines?.length) {
    throw new Error(`未获取到${definition.name}历史指数序列`);
  }

  const points = parsed.data.klines
    .map((line) => {
      const [date, , close] = line.split(',');
      return { date, close: Number(close) };
    })
    .filter((point) => point.date && Number.isFinite(point.close));

  return {
    code: parsed.data.code ?? definition.code,
    name: parsed.data.name ?? definition.name,
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
    return benchmark ? benchmarkSnapshot(benchmark) : { code: definition.code, name: definition.name, date: null, changePct: null };
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

export async function fetchFundAnalysis(code: string): Promise<FundAnalysisResponse> {
  const normalizedCode = code.trim();
  try {
    const [series, profileHtml] = await Promise.all([
      getNavSeries(normalizedCode),
      getFundProfilePage(normalizedCode),
    ]);
    const benchmarks = await getBenchmarkSeriesList(series);
    const compareIndex = benchmarks.length ? buildIndexSnapshots(benchmarks) : await getIndexSnapshots();
    const primaryBenchmark = benchmarks.find((item) => item.code === '000300') ?? null;

    if (series.length < 1) {
      return {
        ok: false,
        code: normalizedCode,
        dataDate: null,
        updatedAt: new Date().toISOString(),
        basedOnRecentAvailableData: true,
        basic: null,
        series: { '1m': [], '3m': [], '6m': [], '1y': [] },
        compareIndex,
        analysis: {
          shortTerm: { label: '无法判断', confidence: '低', score: 0 },
          midTerm: { label: '无法判断', confidence: '低', score: 0 },
          coreReasons: ['未能稳定获取基金历史净值序列。'],
          riskFactors: ['当前数据不足，无法给出可靠判断。'],
          indicatorSnapshot: {},
          disclaimer: '本页面仅提供数据分析与辅助判断，不构成投资建议。',
          degraded: true,
          degradedReason: '当前数据不足，无法给出可靠判断。',
        },
        sources: SOURCES,
        message: '当前数据不足，无法给出可靠判断。',
      };
    }

    const rawBasic = await getRawBasicInfo(normalizedCode, series);
    const basic = normalizeBasicInfo(profileHtml, rawBasic);
    basic.returns = buildReturnStats(series);

    const seriesMap = {
      '1m': sliceSeriesByDays(series, RANGE_DAYS['1m']),
      '3m': sliceSeriesByDays(series, RANGE_DAYS['3m']),
      '6m': sliceSeriesByDays(series, RANGE_DAYS['6m']),
      '1y': sliceSeriesByDays(series, RANGE_DAYS['1y']),
    };
    const chartSeriesMap = {
      '1m': alignBenchmarkForChart(seriesMap['1m'], primaryBenchmark),
      '3m': alignBenchmarkForChart(seriesMap['3m'], primaryBenchmark),
      '6m': alignBenchmarkForChart(seriesMap['6m'], primaryBenchmark),
      '1y': alignBenchmarkForChart(seriesMap['1y'], primaryBenchmark),
    };
    const analysis = buildAnalysis(seriesMap['1y'].length >= 20 ? seriesMap['1y'] : series);
    const backtest = buildBacktest(series, primaryBenchmark);

    return {
      ok: true,
      code: normalizedCode,
      dataDate: basic.latestNavDate ?? series.at(-1)?.date ?? null,
      updatedAt: new Date().toISOString(),
      basedOnRecentAvailableData: true,
      basic,
      series: chartSeriesMap,
      compareIndex,
      primaryBenchmark: primaryBenchmark ? benchmarkSnapshot(primaryBenchmark) : null,
      analysis,
      backtest,
      sources: SOURCES,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return {
      ok: false,
      code: normalizedCode,
      dataDate: null,
      updatedAt: new Date().toISOString(),
      basedOnRecentAvailableData: true,
      basic: null,
      series: { '1m': [], '3m': [], '6m': [], '1y': [] },
      compareIndex: [],
      analysis: {
        shortTerm: { label: '无法判断', confidence: '低', score: 0 },
        midTerm: { label: '无法判断', confidence: '低', score: 0 },
        coreReasons: ['接口异常、公开数据结构变化或基金代码无效。'],
        riskFactors: ['当前数据不足，无法给出可靠判断。'],
        indicatorSnapshot: {},
        disclaimer: '本页面仅提供数据分析与辅助判断，不构成投资建议。',
        degraded: true,
        degradedReason: '当前数据不足，无法给出可靠判断。',
      },
      sources: SOURCES,
      message,
    };
  }
}
