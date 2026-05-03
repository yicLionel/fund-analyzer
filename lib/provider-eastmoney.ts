import { buildAnalysis } from './analysis';
import { buildBacktest } from './backtest';
import { buildCalendarReturnStats } from './returns';
import type { BenchmarkSeries, FundAnalysisResponse, FundBasicInfo, FundHoldingAnalysis, HoldingStockInsight, IndexSnapshot, NavPoint, RangeKey, SourceItem } from './types';

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
  {
    name: '东方财富基金持仓与股票快照接口',
    desc: '用于基金重仓股、持仓占比、行业概念、PE/PB、市值等公开字段的持仓质量分析。',
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

function scaledNumber(value: unknown, scale = 100): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value / scale;
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

function extractRows(html: string): string[] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
}

function extractCells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

function extractLinkInfo(cellHtml: string): { text: string | null; secid: string | null } {
  const href = cellHtml.match(/unify\/r\/([^'"]+)/i)?.[1] ?? null;
  return {
    text: cleanHtmlText(cellHtml),
    secid: href,
  };
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

async function getFundHoldings(code: string): Promise<Array<Pick<HoldingStockInsight, 'code' | 'name' | 'secid' | 'weightPct' | 'marketValue' | 'shares'>> & { reportDate?: string | null }> {
  const page = await fetchText(`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=`);
  const reportDate = page.match(/截止至：<font[^>]*>([^<]+)<\/font>/)?.[1] ?? null;
  const rows = extractRows(page);
  const holdings = rows.flatMap((row) => {
    const cells = extractCells(row);
    if (cells.length < 8) return [];
    const codeInfo = extractLinkInfo(cells[1]);
    const nameInfo = extractLinkInfo(cells[2]);
    if (!codeInfo.text || !nameInfo.text) return [];
    return [
      {
        code: codeInfo.text,
        name: nameInfo.text,
        secid: codeInfo.secid,
        weightPct: parseNumber(cleanHtmlText(cells[6])),
        shares: parseNumber(cleanHtmlText(cells[7])),
        marketValue: parseNumber(cleanHtmlText(cells[8])),
      },
    ];
  });
  return Object.assign(holdings, { reportDate });
}

async function getStockSnapshot(secid: string | null | undefined) {
  if (!secid) return null;
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/get');
  url.searchParams.set('secid', secid);
  url.searchParams.set('fields', 'f43,f57,f58,f60,f116,f117,f127,f128,f129,f162,f167,f168,f170');
  const page = await fetchText(url.toString());
  const parsed = JSON.parse(page) as {
    rc: number;
    data?: Record<string, unknown>;
  };
  if (parsed.rc !== 0 || !parsed.data) return null;
  return parsed.data;
}

function isAShareSecid(secid?: string | null) {
  return Boolean(secid && /^[01]\.\d{6}$/.test(secid));
}

function inferPriceScale(secid?: string | null) {
  return isAShareSecid(secid) ? 100 : 1000;
}

function valuationLabel(pe?: number | null, pb?: number | null): HoldingStockInsight['valuationLabel'] {
  if ((pe === null || pe === undefined || pe <= 0) && (pb === null || pb === undefined || pb <= 0)) return '待判断';
  if ((pe !== null && pe !== undefined && pe > 45) || (pb !== null && pb !== undefined && pb > 8)) return '偏高';
  if ((pe !== null && pe !== undefined && pe < 18) && (pb === null || pb === undefined || pb < 3)) return '偏低';
  return '合理';
}

function qualityLabel(weightPct?: number | null, marketCap?: number | null): HoldingStockInsight['qualityLabel'] {
  if (!marketCap && !weightPct) return '待判断';
  if ((marketCap ?? 0) >= 300_000_000_000 || (weightPct ?? 0) >= 8) return '较强';
  if ((marketCap ?? 0) < 30_000_000_000 && (weightPct ?? 0) < 2) return '偏弱';
  return '中性';
}

function policySensitivity(industry?: string | null, concepts: string[] = []): HoldingStockInsight['policySensitivity'] {
  const text = `${industry ?? ''} ${concepts.join(' ')}`;
  if (!text.trim()) return '待判断';
  if (/地产|医药|医疗|教育|游戏|传媒|金融|证券|保险|银行|军工|半导体|芯片|新能源|光伏|白酒|食品|消费/.test(text)) return '高';
  if (/央国企|出海|人工智能|机器人|数据|算力|电商|互联网|周期|资源|煤炭|有色/.test(text)) return '中';
  return '低';
}

function holdingComment(item: HoldingStockInsight) {
  const parts = [
    item.industry ? `所属${item.industry}` : null,
    item.valuationLabel !== '待判断' ? `估值${item.valuationLabel}` : null,
    item.qualityLabel !== '待判断' ? `公司规模/持仓权重${item.qualityLabel}` : null,
    item.policySensitivity !== '待判断' ? `政策与行业敏感度${item.policySensitivity}` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join('，')}。` : '公开快照字段不足，暂不做确定性评价。';
}

function classifyFundStructure(name?: string | null, type?: string | null): Pick<FundHoldingAnalysis, 'structureType' | 'holdingScope' | 'disclosureNote'> {
  const text = `${name ?? ''} ${type ?? ''}`.toUpperCase();
  const isQdii = /QDII|纳斯达克|NASDAQ|标普|S&P|海外|全球|美国|港股|恒生/.test(text);
  const isFeeder = /联接|连接|FEEDER/.test(text);
  const isEtf = /ETF|交易型开放式指数/.test(text);
  const isLof = /LOF/.test(text);

  if (isQdii && isEtf && isFeeder) {
    return {
      structureType: 'QDII/ETF联接',
      holdingScope: '目标ETF/指数穿透参考',
      disclosureNote: '该基金通常通过目标 ETF 或海外资产实现暴露，当前重仓股应视为穿透或披露口径参考；更精确判断应继续查看目标 ETF 和底层指数成分。',
    };
  }
  if (isEtf && isFeeder) {
    return {
      structureType: 'ETF联接',
      holdingScope: '目标ETF/指数穿透参考',
      disclosureNote: 'ETF 联接基金本身可能主要持有目标 ETF，不能只用本基金直接持仓下结论；应优先穿透目标 ETF 或跟踪指数成分股。',
    };
  }
  if (isEtf) {
    return {
      structureType: 'ETF',
      holdingScope: '指数成分参考',
      disclosureNote: 'ETF 持仓主要由跟踪指数成分决定，重仓分析应以指数成分权重、PCF 清单或基金公告为准。',
    };
  }
  if (isQdii) {
    return {
      structureType: 'QDII',
      holdingScope: '海外持仓披露参考',
      disclosureNote: 'QDII 持仓披露频率和字段完整度可能低于 A 股基金，海外股票估值字段也可能存在口径差异。',
    };
  }
  if (isLof) {
    return {
      structureType: 'LOF',
      holdingScope: '基金直接重仓',
      disclosureNote: 'LOF 可上市交易，但持仓分析仍以基金定期报告披露的重仓股为主要依据。',
    };
  }
  return {
    structureType: '普通基金',
    holdingScope: '基金直接重仓',
    disclosureNote: '当前按基金定期报告披露的前十大重仓股进行分析。',
  };
}

async function buildFundHoldingAnalysis(code: string, basic: FundBasicInfo): Promise<FundHoldingAnalysis | null> {
  const structure = classifyFundStructure(basic.name, basic.type);
  try {
    const holdings = await getFundHoldings(code);
    if (!holdings.length) {
      return {
        ...structure,
        reportDate: holdings.reportDate ?? null,
        topHoldingWeight: null,
        concentrationLabel: '待判断',
        overallLabel: '待判断',
        summary: `${structure.structureType}暂未获取到可用重仓明细，当前无法对底层公司做穿透判断。`,
        risks: [structure.disclosureNote, '建议结合基金公告、目标 ETF 持仓、指数成分股或申购赎回清单进一步核验。'],
        holdings: [],
      };
    }
    const enriched = await Promise.all(
      holdings.map(async (holding): Promise<HoldingStockInsight> => {
        const snapshot = await getStockSnapshot(holding.secid);
        const concepts = typeof snapshot?.f129 === 'string' ? snapshot.f129.split(',').filter(Boolean).slice(0, 6) : [];
        const pe = scaledNumber(snapshot?.f162);
        const pb = scaledNumber(snapshot?.f167);
        const marketCap = typeof snapshot?.f116 === 'number' && Number.isFinite(snapshot.f116) ? snapshot.f116 : null;
        const latestPrice = scaledNumber(snapshot?.f43, inferPriceScale(holding.secid));
        const changePct = scaledNumber(snapshot?.f170);
        const industry = typeof snapshot?.f127 === 'string' ? snapshot.f127 : null;
        const insight: HoldingStockInsight = {
          ...holding,
          latestPrice,
          changePct,
          pe,
          pb,
          marketCap,
          industry,
          concepts,
          valuationLabel: valuationLabel(pe, pb),
          qualityLabel: qualityLabel(holding.weightPct, marketCap),
          policySensitivity: policySensitivity(industry, concepts),
          comment: '',
        };
        return { ...insight, comment: holdingComment(insight) };
      })
    );

    const topHoldingWeight = enriched.reduce((sum, item) => sum + (item.weightPct ?? 0), 0);
    const concentrationLabel: FundHoldingAnalysis['concentrationLabel'] =
      topHoldingWeight >= 60 ? '集中' : topHoldingWeight >= 35 ? '适中' : topHoldingWeight > 0 ? '分散' : '待判断';
    const expensiveCount = enriched.filter((item) => item.valuationLabel === '偏高').length;
    const strongCount = enriched.filter((item) => item.qualityLabel === '较强').length;
    const highPolicyCount = enriched.filter((item) => item.policySensitivity === '高').length;
    const overallLabel: FundHoldingAnalysis['overallLabel'] =
      strongCount >= 4 && expensiveCount <= 3 ? '偏强' : expensiveCount >= 5 || highPolicyCount >= 6 ? '偏弱' : '中性';

    return {
      ...structure,
      reportDate: holdings.reportDate ?? null,
      topHoldingWeight,
      concentrationLabel,
      overallLabel,
      summary: `${structure.structureType}，当前口径为${structure.holdingScope}；前十大重仓合计约 ${topHoldingWeight.toFixed(2)}%，持仓集中度${concentrationLabel}；${strongCount} 只重仓股规模/权重质量较强，${expensiveCount} 只估值偏高。`,
      risks: [
        structure.disclosureNote,
        highPolicyCount ? `${highPolicyCount} 只重仓股处于政策或行业变化较敏感领域，需要结合最新监管和产业政策跟踪。` : '暂未识别到大量高政策敏感标签，但仍需关注行业政策变化。',
        expensiveCount ? '部分重仓股估值偏高，若盈利预期下修，基金净值可能承受估值回落压力。': '重仓股估值压力整体不突出，但仍需关注业绩兑现情况。',
        concentrationLabel === '集中' ? '前十大持仓集中度较高，个股或单一行业波动会更明显传导到基金净值。' : '持仓集中度未明显过高，但仍需观察行业相关性。',
      ],
      holdings: enriched,
    };
  } catch {
    return {
      ...structure,
      reportDate: null,
      topHoldingWeight: null,
      concentrationLabel: '待判断',
      overallLabel: '待判断',
      summary: `${structure.structureType}持仓接口暂时不可用，无法完成底层公司分析。`,
      risks: [structure.disclosureNote, '当前持仓数据获取失败，建议稍后重试或以基金公告披露为准。'],
      holdings: [],
    };
  }
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
    basic.returns = buildCalendarReturnStats(series);
    const holdingAnalysis = await buildFundHoldingAnalysis(normalizedCode, basic);

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
      holdingAnalysis,
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
