import { buildAnalysis } from './analysis';
import type { BacktestHorizonResult, BacktestSummary, BenchmarkSeries, NavPoint } from './types';

const HORIZONS: Array<Pick<BacktestHorizonResult, 'horizonDays' | 'signalType'>> = [
  { horizonDays: 5, signalType: 'shortTerm' },
  { horizonDays: 20, signalType: 'midTerm' },
  { horizonDays: 60, signalType: 'midTerm' },
];

const MIN_LOOKBACK_DAYS = 120;
const SIGNAL_LOOKBACK_DAYS = 252;
const DEFAULT_COST_BPS = 20;

function pct(a: number, b: number): number {
  return b === 0 ? 0 : ((a - b) / b) * 100;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function positiveRate(values: number[]): number | null {
  if (!values.length) return null;
  return (values.filter((value) => value > 0).length / values.length) * 100;
}

function createBenchmarkLookup(benchmark?: BenchmarkSeries | null): Map<string, number> {
  return new Map((benchmark?.points ?? []).map((point) => [point.date, point.close]));
}

function maxDrawdownFromEntry(entry: number, path: NavPoint[]): number {
  let peak = entry;
  let maxDrawdown = 0;
  for (const point of path) {
    peak = Math.max(peak, point.nav);
    maxDrawdown = Math.min(maxDrawdown, pct(point.nav, peak));
  }
  return maxDrawdown;
}

function round(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(2));
}

export function buildBacktest(series: NavPoint[], benchmark?: BenchmarkSeries | null, costBps = DEFAULT_COST_BPS): BacktestSummary {
  const sortedSeries = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const benchmarkByDate = createBenchmarkLookup(benchmark);
  const maxHorizon = Math.max(...HORIZONS.map((item) => item.horizonDays));
  if (sortedSeries.length < MIN_LOOKBACK_DAYS + maxHorizon) {
    return {
      ok: false,
      minLookbackDays: MIN_LOOKBACK_DAYS,
      costBps,
      benchmark: benchmark ? { code: benchmark.code, name: benchmark.name, date: benchmark.dataDate } : null,
      horizons: [],
      methodology: '滚动回测仅使用信号日之前的净值序列，观察后续持有期扣除估算成本后的表现。',
      message: '历史净值样本不足，暂无法形成稳定回测结果。',
    };
  }

  const costPct = costBps / 100;
  const latestSignal = buildAnalysis(sortedSeries.slice(-SIGNAL_LOOKBACK_DAYS));

  const horizons = HORIZONS.map<BacktestHorizonResult>(({ horizonDays, signalType }) => {
    const signalLabel = latestSignal[signalType].label;
    const signalReturns: number[] = [];
    const signalBenchmarkReturns: number[] = [];
    const signalExcessReturns: number[] = [];
    const allReturns: number[] = [];
    const allBenchmarkReturns: number[] = [];
    const allExcessReturns: number[] = [];
    const signalDrawdowns: number[] = [];

    for (let index = MIN_LOOKBACK_DAYS - 1; index + horizonDays < sortedSeries.length; index += 1) {
      const trainingSlice = sortedSeries.slice(Math.max(0, index + 1 - SIGNAL_LOOKBACK_DAYS), index + 1);
      const analysis = buildAnalysis(trainingSlice);
      const entry = sortedSeries[index].nav;
      const exit = sortedSeries[index + horizonDays].nav;
      const benchmarkEntry = benchmarkByDate.get(sortedSeries[index].date);
      const benchmarkExit = benchmarkByDate.get(sortedSeries[index + horizonDays].date);
      const benchmarkReturn =
        benchmarkEntry !== undefined && benchmarkExit !== undefined ? pct(benchmarkExit, benchmarkEntry) : null;
      const netReturn = pct(exit, entry) - costPct;

      allReturns.push(netReturn);
      if (benchmarkReturn !== null) {
        allBenchmarkReturns.push(benchmarkReturn);
        allExcessReturns.push(netReturn - benchmarkReturn);
      }
      if (analysis[signalType].label === signalLabel) {
        signalReturns.push(netReturn);
        if (benchmarkReturn !== null) {
          signalBenchmarkReturns.push(benchmarkReturn);
          signalExcessReturns.push(netReturn - benchmarkReturn);
        }
        signalDrawdowns.push(maxDrawdownFromEntry(entry, sortedSeries.slice(index + 1, index + horizonDays + 1)));
      }
    }

    return {
      horizonDays,
      signalType,
      signalLabel,
      sampleSize: signalReturns.length,
      positiveRate: round(positiveRate(signalReturns)),
      averageReturn: round(average(signalReturns)),
      medianReturn: round(median(signalReturns)),
      averageBenchmarkReturn: round(average(signalBenchmarkReturns)),
      averageExcessReturn: round(average(signalExcessReturns)),
      excessPositiveRate: round(positiveRate(signalExcessReturns)),
      averageMaxDrawdown: round(average(signalDrawdowns)),
      allSampleSize: allReturns.length,
      allPositiveRate: round(positiveRate(allReturns)),
      allAverageReturn: round(average(allReturns)),
      allAverageBenchmarkReturn: round(average(allBenchmarkReturns)),
      allAverageExcessReturn: round(average(allExcessReturns)),
    };
  });

  return {
    ok: true,
    minLookbackDays: MIN_LOOKBACK_DAYS,
    costBps,
    benchmark: benchmark ? { code: benchmark.code, name: benchmark.name, date: benchmark.dataDate } : null,
    horizons,
    methodology: `滚动回测仅使用信号日之前的净值序列，按当前同类信号统计未来 5/20/60 个交易日扣除估算往返成本后的历史表现${benchmark ? `，并与${benchmark.name}同期涨跌比较。` : '。'}`,
  };
}
