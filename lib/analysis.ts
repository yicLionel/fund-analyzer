import { AnalysisResult, ConfidenceLabel, NavPoint, TrendLabel } from './types';

function sma(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const slice = values.slice(values.length - window);
  return slice.reduce((a, b) => a + b, 0) / window;
}

function ema(values: number[], window: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (window + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

function rsi(values: number[], window = 14): number | null {
  if (values.length <= window) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - window; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function std(values: number[]): number | null {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function pct(a: number, b: number): number {
  return b === 0 ? 0 : ((a - b) / b) * 100;
}

function labelFromScore(score: number): TrendLabel {
  if (Number.isNaN(score)) return '无法判断';
  if (score >= 2) return '偏强';
  if (score <= -2) return '偏弱';
  return '震荡';
}

function confidenceFromCoverage(hasData: boolean, signals: number): ConfidenceLabel {
  if (!hasData || signals <= 2) return '低';
  if (signals <= 4) return '中';
  return '高';
}

export function buildAnalysis(series: NavPoint[]): AnalysisResult {
  if (!series || series.length < 20) {
    return {
      shortTerm: { label: '无法判断', confidence: '低', score: 0 },
      midTerm: { label: '无法判断', confidence: '低', score: 0 },
      coreReasons: ['可用净值序列长度不足，无法形成稳定的技术指标与趋势判读。'],
      riskFactors: ['样本点不足，近期判断误差会显著放大。'],
      indicatorSnapshot: {},
      disclaimer: '本页面仅提供基于公开数据的辅助分析，不构成投资建议。',
      degraded: true,
      degradedReason: '当前数据不足，无法给出可靠判断。',
    };
  }

  const navs = series.map((p) => p.nav);
  const latest = navs[navs.length - 1];
  const prev = navs[navs.length - 2];
  const ma5 = sma(navs, 5);
  const ma10 = sma(navs, 10);
  const ma20 = sma(navs, 20);
  const ma60 = sma(navs, 60);
  const rsi14 = rsi(navs, 14);
  const ema12 = ema(navs, 12);
  const ema26 = ema(navs, 26);
  const macdDiff = ema12.length && ema26.length ? ema12[ema12.length - 1] - ema26[ema26.length - 1] : null;
  const macdSignalList = ema(ema12.map((v, i) => v - ema26[i]), 9);
  const macdSignal = macdSignalList.length ? macdSignalList[macdSignalList.length - 1] : null;
  const macdHist = macdDiff !== null && macdSignal !== null ? macdDiff - macdSignal : null;
  const rolling20 = navs.slice(-20);
  const ma20Mean = ma20;
  const sd20 = std(rolling20);
  const upper = ma20Mean !== null && sd20 !== null ? ma20Mean + 2 * sd20 : null;
  const lower = ma20Mean !== null && sd20 !== null ? ma20Mean - 2 * sd20 : null;

  const shortScoreParts: number[] = [];
  const midScoreParts: number[] = [];
  const reasons: string[] = [];
  const risks: string[] = [];

  if (ma5 !== null && ma10 !== null) {
    shortScoreParts.push(ma5 > ma10 ? 1 : -1);
    reasons.push(ma5 > ma10 ? '短周期均线位于长一点的短周期均线之上，短线动能偏强。' : '短周期均线未形成上行动能优势，短线走势偏谨慎。');
  }

  if (ma20 !== null && ma60 !== null) {
    midScoreParts.push(ma20 > ma60 ? 1 : -1);
    reasons.push(ma20 > ma60 ? '中期均线结构相对健康，近阶段净值中枢高于更长周期均值。' : '中期均线仍弱于更长周期均值，中期修复力度有限。');
  }

  const dayMove = pct(latest, prev);
  shortScoreParts.push(dayMove > 0 ? 0.5 : -0.5);
  reasons.push(dayMove > 0 ? '最近一个可用交易日净值继续抬升。' : '最近一个可用交易日净值回落，短线扰动增加。');

  if (rsi14 !== null) {
    if (rsi14 >= 55 && rsi14 <= 70) {
      shortScoreParts.push(1);
      reasons.push('RSI 位于相对强势但未明显过热区间。');
    } else if (rsi14 > 70) {
      shortScoreParts.push(-0.5);
      risks.push('RSI 已接近或进入偏热区间，短线可能出现震荡或回撤。');
    } else if (rsi14 < 45) {
      shortScoreParts.push(-1);
      reasons.push('RSI 偏弱，说明近期上涨动能不足。');
    }
  }

  if (macdHist !== null) {
    shortScoreParts.push(macdHist > 0 ? 1 : -1);
    midScoreParts.push(macdHist > 0 ? 0.5 : -0.5);
    reasons.push(macdHist > 0 ? 'MACD 柱体为正，说明趋势动能有改善迹象。' : 'MACD 柱体为负，趋势动能尚未完全转强。');
  }

  if (upper !== null && lower !== null) {
    if (latest > upper) {
      shortScoreParts.push(-0.5);
      risks.push('净值已逼近或突破布林带上轨，短线可能面临波动放大。');
    } else if (latest < lower) {
      shortScoreParts.push(0.5);
      reasons.push('净值接近布林带下轨，若后续止跌，存在技术性修复机会。');
    }
  }

  const monthApprox = navs.length >= 21 ? pct(latest, navs[navs.length - 21]) : null;
  const quarterApprox = navs.length >= 61 ? pct(latest, navs[navs.length - 61]) : null;
  if (monthApprox !== null) {
    shortScoreParts.push(monthApprox > 0 ? 0.5 : -0.5);
  }
  if (quarterApprox !== null) {
    midScoreParts.push(quarterApprox > 0 ? 1 : -1);
  }

  const shortScore = Number(shortScoreParts.reduce((a, b) => a + b, 0).toFixed(2));
  const midScore = Number((midScoreParts.reduce((a, b) => a + b, 0) + shortScore * 0.25).toFixed(2));

  if (Math.abs(dayMove) > 2) {
    risks.push('最近单日波动较大，短线判断的不确定性上升。');
  }

  const rollingVol = std(
    navs.slice(1).map((v, i) => pct(v, navs[i]))
  );
  if (rollingVol !== null && rollingVol > 1.5) {
    risks.push('近阶段净值波动率偏高，趋势延续性可能受市场情绪影响。');
  }

  return {
    shortTerm: {
      label: labelFromScore(shortScore),
      confidence: confidenceFromCoverage(true, shortScoreParts.length),
      score: shortScore,
    },
    midTerm: {
      label: labelFromScore(midScore),
      confidence: confidenceFromCoverage(true, midScoreParts.length + 2),
      score: midScore,
    },
    coreReasons: Array.from(new Set(reasons)).slice(0, 5),
    riskFactors: Array.from(new Set(risks)).slice(0, 4).length
      ? Array.from(new Set(risks)).slice(0, 4)
      : ['市场风格切换、重仓板块波动、基金经理调仓与申赎变化都可能影响后续表现。'],
    indicatorSnapshot: {
      MA5: ma5?.toFixed(4) ?? 'N/A',
      MA10: ma10?.toFixed(4) ?? 'N/A',
      MA20: ma20?.toFixed(4) ?? 'N/A',
      MA60: ma60?.toFixed(4) ?? 'N/A',
      RSI14: rsi14?.toFixed(2) ?? 'N/A',
      MACD: macdHist?.toFixed(4) ?? 'N/A',
      '布林上轨': upper?.toFixed(4) ?? 'N/A',
      '布林下轨': lower?.toFixed(4) ?? 'N/A',
    },
    disclaimer: '本页面仅提供基于公开数据的辅助分析，不构成投资建议。基金过往业绩不预示未来表现。',
    degraded: false,
  };
}
