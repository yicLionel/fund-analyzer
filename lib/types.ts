export type RangeKey = '1m' | '3m' | '6m' | '1y';
export type TrendLabel = '偏强' | '震荡' | '偏弱' | '无法判断';
export type ConfidenceLabel = '高' | '中' | '低';

export interface ReturnStats {
  day1?: number | null;
  week1?: number | null;
  month1?: number | null;
  month3?: number | null;
  month6?: number | null;
  year1?: number | null;
}

export interface FundBasicInfo {
  code: string;
  name: string;
  type?: string | null;
  establishDate?: string | null;
  company?: string | null;
  manager?: string | null;
  latestNav?: number | null;
  latestNavDate?: string | null;
  returns: ReturnStats;
}

export interface StockBasicInfo {
  code: string;
  name: string;
  market: 'SH' | 'SZ' | 'UNKNOWN';
  latestClose?: number | null;
  latestDate?: string | null;
  latestVolume?: number | null;
  latestAmount?: number | null;
  returns: ReturnStats;
}

export interface NavPoint {
  date: string;
  nav: number;
  benchmark?: number | null;
}

export interface BenchmarkPoint {
  date: string;
  close: number;
}

export interface BenchmarkSeries {
  code: string;
  name: string;
  dataDate: string | null;
  points: BenchmarkPoint[];
}

export interface IndexSnapshot {
  code: string;
  name: string;
  date?: string | null;
  close?: number | null;
  changePct?: number | null;
}

export interface AnalysisResult {
  shortTerm: {
    label: TrendLabel;
    confidence: ConfidenceLabel;
    score: number;
  };
  midTerm: {
    label: TrendLabel;
    confidence: ConfidenceLabel;
    score: number;
  };
  coreReasons: string[];
  riskFactors: string[];
  indicatorSnapshot: Record<string, string>;
  disclaimer: string;
  degraded: boolean;
  degradedReason?: string;
}

export interface SourceItem {
  name: string;
  desc: string;
}

export interface BacktestHorizonResult {
  horizonDays: number;
  signalType: 'shortTerm' | 'midTerm';
  signalLabel: TrendLabel;
  sampleSize: number;
  positiveRate: number | null;
  averageReturn: number | null;
  medianReturn: number | null;
  averageBenchmarkReturn?: number | null;
  averageExcessReturn?: number | null;
  excessPositiveRate?: number | null;
  averageMaxDrawdown: number | null;
  allSampleSize: number;
  allPositiveRate: number | null;
  allAverageReturn: number | null;
  allAverageBenchmarkReturn?: number | null;
  allAverageExcessReturn?: number | null;
}

export interface BacktestSummary {
  ok: boolean;
  minLookbackDays: number;
  costBps: number;
  benchmark?: IndexSnapshot | null;
  horizons: BacktestHorizonResult[];
  methodology: string;
  message?: string;
}

export interface FundAnalysisResponse {
  ok: boolean;
  code: string;
  dataDate: string | null;
  updatedAt: string;
  basedOnRecentAvailableData: boolean;
  basic: FundBasicInfo | null;
  series: Record<RangeKey, NavPoint[]>;
  compareIndex: IndexSnapshot[];
  primaryBenchmark?: IndexSnapshot | null;
  analysis: AnalysisResult;
  backtest?: BacktestSummary;
  sources: SourceItem[];
  message?: string;
}

export interface StockAnalysisResponse {
  ok: boolean;
  code: string;
  dataDate: string | null;
  updatedAt: string;
  basic: StockBasicInfo | null;
  series: Record<RangeKey, NavPoint[]>;
  compareIndex: IndexSnapshot[];
  primaryBenchmark?: IndexSnapshot | null;
  analysis: AnalysisResult;
  backtest?: BacktestSummary;
  sources: SourceItem[];
  message?: string;
}
