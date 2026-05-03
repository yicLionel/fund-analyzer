'use client';

import { useEffect, useMemo, useState } from 'react';
import NavChart from '@/components/NavChart';
import type { AssetType, ComparisonItem, DecisionItem, FundAnalysisResponse, HistoryItem, RangeKey, StockAnalysisResponse, TrendLabel } from '@/lib/types';

const VISITOR_ID_STORAGE_KEY = 'fund-analyzer:visitor-id';
const MAX_HISTORY_ITEMS = 10;
type AnalysisResponse = FundAnalysisResponse | StockAnalysisResponse;
type ActivePanel = 'history' | 'tracking' | 'compare' | null;
type OperationAdviceLabel = '增持' | '持有' | '减持' | '待判断';

interface OperationAdvice {
  label: OperationAdviceLabel;
  tone: 'up' | 'hold' | 'down' | 'muted';
  reason: string;
}

interface DecisionPrediction {
  shortTermLabel: TrendLabel;
  midTermLabel: TrendLabel;
  shortTermScore: number;
  midTermScore: number;
  backtestExcess?: number | null;
  horizonDays?: number | null;
  dataDate?: string | null;
  updatedAt: string;
  degraded?: boolean;
}

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: '1m', label: '近一月' },
  { key: '3m', label: '近三月' },
  { key: '6m', label: '近六月' },
  { key: '1y', label: '近一年' },
];

function isHistoryItem(value: unknown): value is HistoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<HistoryItem>;
  const navValid = item.latestNav === undefined || item.latestNav === null || typeof item.latestNav === 'number';
  const navDateValid = item.latestNavDate === undefined || item.latestNavDate === null || typeof item.latestNavDate === 'string';
  return (
    (item.assetType === 'fund' || item.assetType === 'stock') &&
    typeof item.code === 'string' &&
    /^\d{6}$/.test(item.code) &&
    typeof item.name === 'string' &&
    typeof item.viewedAt === 'string' &&
    navValid &&
    navDateValid
  );
}

function isDecisionItem(value: unknown): value is DecisionItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DecisionItem>;
  const amountValid = item.buyAmount === undefined || item.buyAmount === null || (typeof item.buyAmount === 'number' && Number.isFinite(item.buyAmount));
  const returnValid =
    item.manualReturnPct === undefined || item.manualReturnPct === null || (typeof item.manualReturnPct === 'number' && Number.isFinite(item.manualReturnPct));
  return (
    typeof item.id === 'string' &&
    (item.assetType === 'fund' || item.assetType === 'stock') &&
    typeof item.code === 'string' &&
    /^\d{6}$/.test(item.code) &&
    typeof item.name === 'string' &&
    typeof item.buyPrice === 'number' &&
    Number.isFinite(item.buyPrice) &&
    typeof item.buyDate === 'string' &&
    amountValid &&
    returnValid &&
    typeof item.createdAt === 'string'
  );
}

function isComparisonItem(value: unknown): value is ComparisonItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ComparisonItem>;
  const returns = item.returns as Record<string, unknown> | undefined;
  return (
    typeof item.id === 'string' &&
    (item.assetType === 'fund' || item.assetType === 'stock') &&
    typeof item.code === 'string' &&
    /^\d{6}$/.test(item.code) &&
    typeof item.name === 'string' &&
    typeof returns === 'object' &&
    returns !== null &&
    typeof item.updatedAt === 'string'
  );
}

function isStockResult(data: AnalysisResponse | null): data is StockAnalysisResponse {
  return Boolean(data?.basic && 'latestClose' in data.basic);
}

function assetLabel(assetType: AssetType) {
  return assetType === 'fund' ? '基金' : '股票';
}

function fmtPct(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return `${value.toFixed(2)}%`;
}

function fmtSignedPct(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtNum(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return value.toFixed(4);
}

function fmtMoney(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return value.toLocaleString('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  });
}

function fmtLargeMoney(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(2)} 亿`;
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)} 万`;
  return value.toFixed(2);
}

function fmtIndexPoint(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return value.toFixed(2);
}

function fmtDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDate(value?: string | null) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN');
}

function daysBetween(from: string, to?: string | null) {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / (24 * 60 * 60 * 1000)));
}

function TrendTag({ label }: { label: string }) {
  const cls = label === '偏强' ? 'good' : label === '偏弱' ? 'bad' : 'warn';
  return <span className={`tag ${cls}`}>{label}</span>;
}

function signalTypeLabel(signalType: 'shortTerm' | 'midTerm') {
  return signalType === 'shortTerm' ? '短期' : '中期';
}

function parseOptionalNumber(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildDecisionPrediction(data: AnalysisResponse): DecisionPrediction {
  const primary = data.backtest?.horizons.find((item) => item.horizonDays === 20) ?? data.backtest?.horizons[0] ?? null;
  return {
    shortTermLabel: data.analysis.shortTerm.label,
    midTermLabel: data.analysis.midTerm.label,
    shortTermScore: data.analysis.shortTerm.score,
    midTermScore: data.analysis.midTerm.score,
    backtestExcess: primary?.averageExcessReturn ?? null,
    horizonDays: primary?.horizonDays ?? null,
    dataDate: data.dataDate,
    updatedAt: new Date().toISOString(),
    degraded: data.analysis.degraded,
  };
}

function getOperationAdvice(returnPct: number | null, buyAmount?: number | null, holdingDays?: number | null, prediction?: DecisionPrediction | null): OperationAdvice {
  if (!prediction) {
    return {
      label: '待判断',
      tone: 'muted',
      reason: '请先刷新追踪获取最新趋势预测，再结合金额和收益率生成仓位建议。',
    };
  }

  if (prediction.degraded || prediction.shortTermLabel === '无法判断' || prediction.midTermLabel === '无法判断') {
    return {
      label: '持有',
      tone: 'hold',
      reason: '当前预测数据不足或信号降级，先不建议主动加减仓，等待更完整的数据确认。',
    };
  }

  if (returnPct === null || Number.isNaN(returnPct)) {
    return {
      label: '待判断',
      tone: 'muted',
      reason: '已有趋势预测，但还需要填写当前收益率，才能判断这笔持仓的盈亏风险。',
    };
  }

  const amount = buyAmount ?? 0;
  const days = holdingDays ?? 0;
  const forecastScore = prediction.shortTermScore * 0.45 + prediction.midTermScore * 0.55;
  const excess = prediction.backtestExcess ?? 0;
  const bullish = prediction.midTermLabel === '偏强' && prediction.shortTermLabel !== '偏弱' && excess >= -1;
  const bearish = prediction.midTermLabel === '偏弱' || (prediction.shortTermLabel === '偏弱' && excess < 0) || forecastScore <= -0.35;
  const highExposure = amount >= 50000;

  if (bearish && (returnPct <= -3 || highExposure)) {
    return {
      label: '减持',
      tone: 'down',
      reason: `未来预测偏弱，且当前${returnPct >= 0 ? '已有盈利或仓位较重' : '处于亏损区间'}，建议先降低风险敞口。`,
    };
  }

  if (returnPct <= -10 && !bullish) {
    return {
      label: '减持',
      tone: 'down',
      reason: '回撤较深，同时未来预测没有明显修复信号，建议减持控制单笔亏损。',
    };
  }

  if (returnPct >= 18 && !bullish) {
    return {
      label: '减持',
      tone: 'down',
      reason: '当前已有较高浮盈，但未来预测并未继续偏强，建议分批止盈锁定收益。',
    };
  }

  if (bullish && returnPct >= -4 && returnPct <= 10 && !highExposure && days >= 3) {
    return {
      label: '增持',
      tone: 'up',
      reason: `短中期预测偏强，${prediction.horizonDays ?? 20}日历史验证超额为 ${fmtSignedPct(prediction.backtestExcess)}，可考虑小幅分批增持。`,
    };
  }

  if (bullish && returnPct <= -4) {
    return {
      label: '持有',
      tone: 'hold',
      reason: '未来预测偏强，但当前浮亏较明显，先持有观察，不建议在回撤未企稳前贸然加仓。',
    };
  }

  return {
    label: '持有',
    tone: 'hold',
    reason: `未来预测为短期${prediction.shortTermLabel}、中期${prediction.midTermLabel}，未形成明确加仓或减仓条件，建议继续跟踪。`,
  };
}

function buildComparisonItem(data: AnalysisResponse, itemAssetType: AssetType): ComparisonItem | null {
  if (!data.basic) return null;
  const latestPrice = isStockResult(data) ? data.basic.latestClose ?? null : data.basic.latestNav ?? null;
  const latestDate = isStockResult(data) ? data.basic.latestDate ?? data.dataDate ?? null : data.basic.latestNavDate ?? data.dataDate ?? null;
  return {
    id: `${itemAssetType}-${data.basic.code || data.code}`,
    assetType: itemAssetType,
    code: data.basic.code || data.code,
    name: data.basic.name || data.code,
    latestPrice,
    latestDate,
    returns: data.basic.returns,
    updatedAt: new Date().toISOString(),
  };
}

function upsertComparisonItem(items: ComparisonItem[], item: ComparisonItem) {
  return [item, ...items.filter((entry) => entry.id !== item.id)];
}

export default function HomePage() {
  const [assetType, setAssetType] = useState<AssetType>('fund');
  const [code, setCode] = useState('161725');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('3m');
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [comparisonItems, setComparisonItems] = useState<ComparisonItem[]>([]);
  const [compareAssetType, setCompareAssetType] = useState<AssetType>('fund');
  const [compareCode, setCompareCode] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [decisionPredictions, setDecisionPredictions] = useState<Record<string, DecisionPrediction>>({});

  const currentSeries = useMemo(() => {
    if (!result) return [];
    return result.series[range] ?? [];
  }, [result, range]);

  const primaryBacktest = useMemo(() => {
    return result?.backtest?.horizons.find((item) => item.horizonDays === 20) ?? result?.backtest?.horizons[0] ?? null;
  }, [result]);

  const display = useMemo(() => {
    if (!result?.basic) {
      return {
        name: result?.code ?? code,
        code,
        type: 'N/A',
        orgLabel: assetType === 'fund' ? '基金公司' : '市场',
        orgValue: 'N/A',
        managerLabel: assetType === 'fund' ? '基金经理' : '成交额',
        managerValue: 'N/A',
        latestLabel: assetType === 'fund' ? '最新净值' : '最新收盘',
        latestValue: null,
        dateLabel: assetType === 'fund' ? '净值日期' : '行情日期',
        dateValue: result?.dataDate ?? null,
      };
    }

    if (isStockResult(result)) {
      return {
        name: result.basic.name,
        code: result.basic.code,
        type: result.basic.market,
        orgLabel: '市场',
        orgValue: result.basic.market,
        managerLabel: '成交额',
        managerValue: result.basic.latestAmount ? `${(result.basic.latestAmount / 100000000).toFixed(2)} 亿` : 'N/A',
        latestLabel: '最新收盘',
        latestValue: result.basic.latestClose ?? null,
        dateLabel: '行情日期',
        dateValue: result.basic.latestDate ?? result.dataDate,
      };
    }

    return {
      name: result.basic.name,
      code: result.basic.code,
      type: result.basic.type ?? 'N/A',
      orgLabel: '基金公司',
      orgValue: result.basic.company ?? 'N/A',
      managerLabel: '基金经理',
      managerValue: result.basic.manager ?? 'N/A',
      latestLabel: '最新净值',
      latestValue: result.basic.latestNav ?? null,
      dateLabel: '净值日期',
      dateValue: result.basic.latestNavDate ?? result.dataDate,
    };
  }, [assetType, code, result]);

  async function loadUserData(nextVisitorId: string) {
    try {
      const res = await fetch(`/api/user-data?visitorId=${encodeURIComponent(nextVisitorId)}`);
      const json = (await res.json()) as {
        ok?: boolean;
        histories?: unknown;
        decisions?: unknown;
        comparisons?: unknown;
      };
      if (!res.ok || !json.ok) return;
      setHistory(Array.isArray(json.histories) ? json.histories.filter(isHistoryItem).slice(0, MAX_HISTORY_ITEMS) : []);
      setDecisions(Array.isArray(json.decisions) ? json.decisions.filter(isDecisionItem) : []);
      setComparisonItems(Array.isArray(json.comparisons) ? json.comparisons.filter(isComparisonItem) : []);
    } catch {
      setError('读取数据库历史记录失败，请稍后重试。');
    }
  }

  useEffect(() => {
    try {
      let nextVisitorId = localStorage.getItem(VISITOR_ID_STORAGE_KEY);
      if (!nextVisitorId) {
        nextVisitorId = crypto.randomUUID();
        localStorage.setItem(VISITOR_ID_STORAGE_KEY, nextVisitorId);
      }
      setVisitorId(nextVisitorId);
      void loadUserData(nextVisitorId);
    } catch {
      const fallback = `visitor-${Date.now()}`;
      setVisitorId(fallback);
      void loadUserData(fallback);
    }
  }, []);

  async function persistDecisionUpdates(next: DecisionItem[]) {
    setDecisions(next);
    try {
      if (!visitorId) return;
      await fetch('/api/user-data/decision', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, items: next }),
      });
    } catch {
      setError('保存买入追踪更新失败，请稍后重试。');
    }
  }

  function updateDecisionDraft(id: string, patch: Partial<Pick<DecisionItem, 'buyAmount' | 'manualReturnPct'>>) {
    setDecisions((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
  }

  function saveDecisionAssessment(id: string) {
    const target = decisions.find((item) => item.id === id);
    if (!target) return;
    void persistDecisionUpdates(
      decisions.map((item) =>
        item.id === id
          ? {
              ...target,
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
  }

  function persistComparisonItem(item: ComparisonItem) {
    if (!visitorId) return;
    void fetch('/api/user-data/comparison', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, item }),
    }).catch(() => setError('保存收益对比失败，请稍后重试。'));
  }

  function recordFundHistory(data: AnalysisResponse, nextAssetType: AssetType) {
    if (!data.basic) return;

    const item: HistoryItem = {
      assetType: nextAssetType,
      code: data.basic.code || data.code,
      name: data.basic.name || data.code,
      latestNav: isStockResult(data) ? data.basic.latestClose ?? null : data.basic.latestNav ?? null,
      latestNavDate: isStockResult(data) ? data.basic.latestDate ?? data.dataDate ?? null : data.basic.latestNavDate ?? data.dataDate ?? null,
      viewedAt: new Date().toISOString(),
    };

    setHistory((prev) => {
      const next = [item, ...prev.filter((entry) => entry.code !== item.code || (entry.assetType ?? 'fund') !== item.assetType)].slice(0, MAX_HISTORY_ITEMS);
      return next;
    });

    if (visitorId) {
      void fetch('/api/user-data/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, item }),
      }).catch(() => setError('保存历史查询失败，请稍后重试。'));
    }
  }

  async function clearHistory() {
    setHistory([]);
    if (!visitorId) return;
    try {
      await fetch(`/api/user-data/history?visitorId=${encodeURIComponent(visitorId)}`, { method: 'DELETE' });
    } catch {
      setError('清空数据库历史记录失败，请稍后重试。');
    }
  }

  function addBuyDecision() {
    if (!result?.basic || display.latestValue === null || display.latestValue === undefined || Number.isNaN(display.latestValue)) {
      setError('当前没有可记录的买入价格，请先完成一次有效查询。');
      return;
    }

    const nextAssetType: AssetType = isStockResult(result) ? 'stock' : 'fund';
    const item: DecisionItem = {
      id: `${nextAssetType}-${display.code}-${Date.now()}`,
      assetType: nextAssetType,
      code: display.code,
      name: display.name,
      buyPrice: display.latestValue,
      buyDate: display.dateValue ?? new Date().toISOString().slice(0, 10),
      currentPrice: display.latestValue,
      currentDate: display.dateValue ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setDecisions([item, ...decisions]);
    setDecisionPredictions((prev) => ({ ...prev, [item.id]: buildDecisionPrediction(result) }));
    if (visitorId) {
      void fetch('/api/user-data/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, item }),
      }).catch(() => setError('保存买入追踪失败，请稍后重试。'));
    }
    setError(null);
  }

  async function refreshDecisionPrices(targets = decisions) {
    if (!targets.length) return;
    setTrackingLoading(true);
    setError(null);
    try {
      const refreshed = await Promise.all(
        targets.map(async (item) => {
          try {
            const res = await fetch(`/api/${item.assetType}/${item.code}`);
            const json = (await res.json()) as AnalysisResponse & { message?: string };
            if (!res.ok || !json.ok || !json.basic) return { item };
            return {
              item: {
                ...item,
                name: json.basic.name || item.name,
                currentPrice: isStockResult(json) ? json.basic.latestClose ?? item.currentPrice ?? null : json.basic.latestNav ?? item.currentPrice ?? null,
                currentDate: isStockResult(json) ? json.basic.latestDate ?? json.dataDate ?? item.currentDate ?? null : json.basic.latestNavDate ?? json.dataDate ?? item.currentDate ?? null,
                updatedAt: new Date().toISOString(),
              },
              prediction: buildDecisionPrediction(json),
            };
          } catch {
            return { item };
          }
        })
      );

      const refreshedById = new Map(refreshed.map(({ item }) => [item.id, item]));
      setDecisionPredictions((prev) => {
        const next = { ...prev };
        for (const entry of refreshed) {
          if (entry.prediction) next[entry.item.id] = entry.prediction;
        }
        return next;
      });
      await persistDecisionUpdates(decisions.map((item) => refreshedById.get(item.id) ?? item));
    } finally {
      setTrackingLoading(false);
    }
  }

  async function removeDecision(id: string) {
    const target = decisions.find((item) => item.id === id);
    if (!target) return;
    if (!window.confirm(`确定移除 ${target.name} 的买入追踪记录吗？这会删除本地保存的这条记录。`)) return;
    setDecisions(decisions.filter((item) => item.id !== id));
    setDecisionPredictions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (!visitorId) return;
    try {
      await fetch(`/api/user-data/decision/${encodeURIComponent(id)}?visitorId=${encodeURIComponent(visitorId)}`, { method: 'DELETE' });
    } catch {
      setError('删除买入追踪失败，请稍后重试。');
    }
  }

  async function fetchComparisonItem(targetCode: string, targetAssetType: AssetType) {
    const res = await fetch(`/api/${targetAssetType}/${targetCode}`);
    const json = (await res.json()) as AnalysisResponse & { message?: string };
    if (!res.ok || !json.ok) {
      throw new Error(json.message || '获取收益对比数据失败');
    }
    const item = buildComparisonItem(json, targetAssetType);
    if (!item) throw new Error('当前标的缺少基础收益数据，无法加入对比。');
    return item;
  }

  function addComparisonFromResult() {
    if (!result) {
      setError('请先完成一次有效查询，再加入收益对比。');
      return;
    }
    const nextAssetType: AssetType = isStockResult(result) ? 'stock' : 'fund';
    const item = buildComparisonItem(result, nextAssetType);
    if (!item) {
      setError('当前标的缺少基础收益数据，无法加入对比。');
      return;
    }
    setComparisonItems((prev) => upsertComparisonItem(prev, item));
    persistComparisonItem(item);
    setCompareAssetType(nextAssetType);
    setCompareCode('');
    setActivePanel('compare');
    setError(null);
  }

  async function addComparisonByCode() {
    const normalizedCode = compareCode.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError(`${assetLabel(compareAssetType)}代码格式无效，请输入 6 位数字代码。`);
      return;
    }

    setCompareLoading(true);
    setError(null);
    try {
      const item = await fetchComparisonItem(normalizedCode, compareAssetType);
      setComparisonItems((prev) => upsertComparisonItem(prev, item));
      persistComparisonItem(item);
      setCompareCode('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '获取收益对比数据失败';
      setError(msg);
    } finally {
      setCompareLoading(false);
    }
  }

  async function refreshComparisonItems() {
    if (!comparisonItems.length) return;
    setCompareLoading(true);
    setError(null);
    try {
      const refreshed = await Promise.all(
        comparisonItems.map(async (item) => {
          try {
            return await fetchComparisonItem(item.code, item.assetType);
          } catch {
            return item;
          }
        })
      );
      setComparisonItems(refreshed);
      if (visitorId) {
        await fetch('/api/user-data/comparison', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId, items: refreshed }),
        });
      }
    } finally {
      setCompareLoading(false);
    }
  }

  function removeComparisonItem(id: string) {
    setComparisonItems((prev) => prev.filter((item) => item.id !== id));
    if (!visitorId) return;
    void fetch(`/api/user-data/comparison/${encodeURIComponent(id)}?visitorId=${encodeURIComponent(visitorId)}`, { method: 'DELETE' }).catch(() =>
      setError('删除收益对比失败，请稍后重试。')
    );
  }

  async function queryAsset(targetCode?: string, targetAssetType: AssetType = assetType) {
    const normalizedCode = (targetCode ?? code).trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError(`${assetLabel(targetAssetType)}代码格式无效，请输入 6 位数字代码。`);
      return;
    }

    setAssetType(targetAssetType);
    setCode(normalizedCode);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/${targetAssetType}/${normalizedCode}`);
      const json = (await res.json()) as AnalysisResponse & { message?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.message || '查询失败');
      }
      setResult(json);
      recordFundHistory(json, targetAssetType);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '查询失败';
      setError(msg);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <header className="topToolbar">
        <div className="toolbarBrand">趋势分析台</div>
        <div className="toolbarActions">
          <button className="toolbarButton" onClick={() => setActivePanel('history')} type="button">
            历史查询
            <span>{history.length}</span>
          </button>
          <button className="toolbarButton" onClick={() => setActivePanel('tracking')} type="button">
            买入追踪
            <span>{decisions.length}</span>
          </button>
          <button className="toolbarButton" onClick={() => setActivePanel('compare')} type="button">
            收益对比
            <span>{comparisonItems.length}</span>
          </button>
        </div>
      </header>

      <section className="commandDeck">
        <div className="hero">
          <div className="eyebrow">Market Research Workbench</div>
          <h1>基金与 A 股趋势分析台</h1>
          <p>
            把基金净值、A 股行情、基准指数、趋势信号和历史回测放在同一个工作流里，先验证，再判断。
          </p>
          <div className="proofStrip">
            <span>公开数据</span>
            <span>沪深300基准</span>
            <span>滚动回测</span>
          </div>
        </div>

        <div className="searchPanel">
          <div>
            <div className="assetSwitch" aria-label="资产类型">
              <button
                className={assetType === 'fund' ? 'active' : ''}
                onClick={() => {
                  setAssetType('fund');
                  setCode('161725');
                  setResult(null);
                  setError(null);
                }}
                type="button"
              >
                基金
              </button>
              <button
                className={assetType === 'stock' ? 'active' : ''}
                onClick={() => {
                  setAssetType('stock');
                  setCode('600519');
                  setResult(null);
                  setError(null);
                }}
                type="button"
              >
                A 股
              </button>
            </div>
            <div className="panelLabel">{assetLabel(assetType)}代码</div>
            <div className="searchBar">
              <input
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={assetType === 'fund' ? '输入 6 位基金代码，例如 161725、019500' : '输入 6 位 A 股代码，例如 600519、300750'}
              />
              <button className="button" onClick={() => queryAsset()} disabled={loading || code.length !== 6}>
                {loading ? '查询中...' : '查询并分析'}
              </button>
            </div>
          </div>
          <div className="deckStats">
            <div>
              <span>主基准</span>
              <strong>{result?.primaryBenchmark?.name ?? '沪深300'}</strong>
            </div>
            <div>
              <span>验证窗口</span>
              <strong>5 / 20 / 60 日</strong>
            </div>
            <div>
              <span>最近数据</span>
              <strong>{result?.dataDate ?? '等待查询'}</strong>
            </div>
          </div>
        </div>
      </section>

      {activePanel ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <button className="overlayBackdrop" onClick={() => setActivePanel(null)} type="button" aria-label="关闭面板" />
          <aside className="floatingPanel">
            {activePanel === 'history' ? (
              <>
                <div className="panelHeader">
                  <div>
                    <div className="sectionTitle">历史查询</div>
                    <div className="small">自动记录当前浏览器最近查看的基金和股票，最多保留 {MAX_HISTORY_ITEMS} 条。</div>
                  </div>
                  <div className="panelActions">
                    {history.length ? (
                      <button className="ghostButton" onClick={clearHistory} type="button">
                        清空历史
                      </button>
                    ) : null}
                    <button className="ghostButton" onClick={() => setActivePanel(null)} type="button">
                      关闭
                    </button>
                  </div>
                </div>

                {history.length ? (
                  <div className="historyList panelList">
                    {history.map((item) => (
                      <button
                        className="historyItem"
                        disabled={loading}
                        key={`${item.assetType ?? 'fund'}-${item.code}`}
                        onClick={() => {
                          setActivePanel(null);
                          void queryAsset(item.code, item.assetType ?? 'fund');
                        }}
                        type="button"
                      >
                        <span className="historyMain">
                          <span className="historyName">{item.name}</span>
                          <span className="historyCode">{assetLabel(item.assetType ?? 'fund')} · {item.code}</span>
                        </span>
                        <span className="historyMeta">
                          <span>{(item.assetType ?? 'fund') === 'fund' ? '净值' : '收盘'} {fmtNum(item.latestNav)}</span>
                          <span>{item.latestNavDate ?? '日期 N/A'}</span>
                          <span>{fmtDateTime(item.viewedAt)} 查看</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="emptyState">暂无历史记录。查询成功后，会在这里沉淀你查看过的基金。</div>
                )}
              </>
            ) : activePanel === 'tracking' ? (
              <>
                <div className="panelHeader">
                  <div>
                    <div className="sectionTitle">买入决策追踪</div>
                    <div className="small">录入购买金额和当前收益率，刷新未来趋势预测后，综合生成持有、增持或减持建议。</div>
                  </div>
                  <div className="panelActions">
                    {decisions.length ? (
                      <button className="ghostButton" onClick={() => refreshDecisionPrices()} disabled={trackingLoading} type="button">
                        {trackingLoading ? '刷新中...' : '刷新追踪'}
                      </button>
                    ) : null}
                    <button className="ghostButton" onClick={() => setActivePanel(null)} type="button">
                      关闭
                    </button>
                  </div>
                </div>

                {decisions.length ? (
                  <div className="decisionList panelList">
                    {decisions.map((item) => {
                      const latestPrice = item.currentPrice ?? item.buyPrice;
                      const changePct = item.buyPrice ? ((latestPrice - item.buyPrice) / item.buyPrice) * 100 : null;
                      const effectiveReturnPct = item.manualReturnPct ?? changePct;
                      const holdingDays = daysBetween(item.buyDate, item.currentDate);
                      const currentResultAssetType = result ? (isStockResult(result) ? 'stock' : 'fund') : null;
                      const currentPrediction =
                        result?.basic && result.basic.code === item.code && currentResultAssetType === item.assetType ? buildDecisionPrediction(result) : null;
                      const prediction = decisionPredictions[item.id] ?? currentPrediction;
                      const advice = getOperationAdvice(effectiveReturnPct, item.buyAmount, holdingDays, prediction);
                      const status = effectiveReturnPct === null ? '未知' : effectiveReturnPct >= 0 ? '盈利' : '亏损';
                      return (
                        <article className="decisionItem" key={item.id}>
                          <div className="decisionHead">
                            <div>
                              <span className="historyCode">{assetLabel(item.assetType)} · {item.code}</span>
                              <h3>{item.name}</h3>
                            </div>
                            <span className={`decisionStatus ${changePct !== null && changePct >= 0 ? 'up' : 'down'}`}>{status}</span>
                          </div>
                          <div className="decisionMetrics">
                            <div>
                              <span>买入价格</span>
                              <strong>{fmtNum(item.buyPrice)}</strong>
                              <small>{fmtDate(item.buyDate)}</small>
                            </div>
                            <div>
                              <span>当前价格</span>
                              <strong>{fmtNum(latestPrice)}</strong>
                              <small>{fmtDate(item.currentDate)}</small>
                            </div>
                            <div>
                              <span>累计涨跌</span>
                              <strong>{fmtSignedPct(effectiveReturnPct)}</strong>
                              <small>{item.manualReturnPct === null || item.manualReturnPct === undefined ? '按当前价格估算' : '用户手动录入'}</small>
                            </div>
                          </div>
                          <div className="decisionInputs">
                            <label className="miniField">
                              <span>购买金额</span>
                              <input
                                className="miniInput"
                                inputMode="decimal"
                                min="0"
                                type="number"
                                value={item.buyAmount ?? ''}
                                onChange={(e) => updateDecisionDraft(item.id, { buyAmount: parseOptionalNumber(e.target.value) })}
                                placeholder="例如 20000"
                              />
                            </label>
                            <label className="miniField">
                              <span>当前收益率 %</span>
                              <input
                                className="miniInput"
                                inputMode="decimal"
                                type="number"
                                value={item.manualReturnPct ?? ''}
                                onChange={(e) => updateDecisionDraft(item.id, { manualReturnPct: parseOptionalNumber(e.target.value) })}
                                placeholder={changePct === null ? '例如 3.5' : changePct.toFixed(2)}
                              />
                            </label>
                            <button className="ghostButton" onClick={() => saveDecisionAssessment(item.id)} type="button">
                              保存
                            </button>
                          </div>
                          <div className={`decisionAdvice ${advice.tone}`}>
                            <div className="adviceHead">
                              <span className={`adviceBadge ${advice.tone}`}>{advice.label}</span>
                              <small>{holdingDays === null ? '持有天数 N/A' : `持有 ${holdingDays} 天`} · {fmtMoney(item.buyAmount)}</small>
                            </div>
                            <p>{advice.reason}</p>
                            {prediction ? (
                              <small>
                                预测依据：短期{prediction.shortTermLabel}，中期{prediction.midTermLabel}
                                {prediction.horizonDays ? `，${prediction.horizonDays}日历史超额 ${fmtSignedPct(prediction.backtestExcess)}` : ''}。
                              </small>
                            ) : (
                              <small>点击“刷新”获取未来趋势预测和历史验证结果。</small>
                            )}
                          </div>
                          <div className="decisionActions">
                            <button
                              className="ghostButton"
                              onClick={() => {
                                setActivePanel(null);
                                void queryAsset(item.code, item.assetType);
                              }}
                              type="button"
                            >
                              查看分析
                            </button>
                            <button className="ghostButton" onClick={() => refreshDecisionPrices([item])} disabled={trackingLoading} type="button">
                              刷新
                            </button>
                            <button className="ghostButton dangerButton" onClick={() => removeDecision(item.id)} type="button">
                              移除
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="emptyState">暂无买入追踪。查询某只基金或股票后，点击“记录买入决策”即可开始跟踪。</div>
                )}
              </>
            ) : (
              <>
                <div className="panelHeader">
                  <div>
                    <div className="sectionTitle">基金 / 股票收益对比</div>
                    <div className="small">把多个基金或 A 股放到同一张表里，横向比较阶段收益和最新价格。</div>
                  </div>
                  <div className="panelActions">
                    {comparisonItems.length ? (
                      <button className="ghostButton" onClick={refreshComparisonItems} disabled={compareLoading} type="button">
                        {compareLoading ? '刷新中...' : '刷新对比'}
                      </button>
                    ) : null}
                    <button className="ghostButton" onClick={() => setActivePanel(null)} type="button">
                      关闭
                    </button>
                  </div>
                </div>

                <div className="compareForm">
                  <div className="assetSwitch compactSwitch" aria-label="对比资产类型">
                    <button
                      className={compareAssetType === 'fund' ? 'active' : ''}
                      onClick={() => setCompareAssetType('fund')}
                      type="button"
                    >
                      基金
                    </button>
                    <button
                      className={compareAssetType === 'stock' ? 'active' : ''}
                      onClick={() => setCompareAssetType('stock')}
                      type="button"
                    >
                      A 股
                    </button>
                  </div>
                  <input
                    className="input compareInput"
                    value={compareCode}
                    onChange={(e) => setCompareCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && compareCode.length === 6 && !compareLoading) {
                        void addComparisonByCode();
                      }
                    }}
                    placeholder={compareAssetType === 'fund' ? '输入基金代码，例如 161725' : '输入股票代码，例如 600519'}
                  />
                  <button className="button compareAddButton" onClick={addComparisonByCode} disabled={compareLoading || compareCode.length !== 6} type="button">
                    {compareLoading ? '添加中...' : '加入对比'}
                  </button>
                </div>

                {comparisonItems.length ? (
                  <div className="compareTableWrap">
                    <table className="compareTable">
                      <thead>
                        <tr>
                          <th>标的</th>
                          <th>类型</th>
                          <th>最新价</th>
                          <th>日期</th>
                          <th>近一日</th>
                          <th>近一周</th>
                          <th>近一月</th>
                          <th>近三月</th>
                          <th>近六月</th>
                          <th>近一年</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparisonItems.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.name}</strong>
                              <span className="inlineMeta">{item.code}</span>
                            </td>
                            <td>{assetLabel(item.assetType)}</td>
                            <td>{fmtNum(item.latestPrice)}</td>
                            <td>{item.latestDate ?? 'N/A'}</td>
                            <td className={(item.returns.day1 ?? 0) >= 0 ? 'returnUp' : 'returnDown'}>{fmtSignedPct(item.returns.day1)}</td>
                            <td className={(item.returns.week1 ?? 0) >= 0 ? 'returnUp' : 'returnDown'}>{fmtSignedPct(item.returns.week1)}</td>
                            <td className={(item.returns.month1 ?? 0) >= 0 ? 'returnUp' : 'returnDown'}>{fmtSignedPct(item.returns.month1)}</td>
                            <td className={(item.returns.month3 ?? 0) >= 0 ? 'returnUp' : 'returnDown'}>{fmtSignedPct(item.returns.month3)}</td>
                            <td className={(item.returns.month6 ?? 0) >= 0 ? 'returnUp' : 'returnDown'}>{fmtSignedPct(item.returns.month6)}</td>
                            <td className={(item.returns.year1 ?? 0) >= 0 ? 'returnUp' : 'returnDown'}>{fmtSignedPct(item.returns.year1)}</td>
                            <td>
                              <div className="tableActions">
                                <button
                                  className="ghostButton"
                                  onClick={() => {
                                    setActivePanel(null);
                                    void queryAsset(item.code, item.assetType);
                                  }}
                                  type="button"
                                >
                                  查看
                                </button>
                                <button className="ghostButton dangerButton" onClick={() => removeComparisonItem(item.id)} type="button">
                                  移除
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="emptyState">暂无收益对比。查询结果页可点击“加入收益对比”，也可以在这里直接输入基金或股票代码添加。</div>
                )}
              </>
            )}
          </aside>
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 16 }} className="error">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ marginTop: 16 }} className="notice">
          正在获取{assetLabel(assetType)}基础信息、历史行情与分析指标，请稍候。
        </div>
      ) : null}

      {result ? (
        <>
          <section className="resultHeader">
            <div>
              <div className="eyebrow">{isStockResult(result) ? 'Current Stock' : 'Current Fund'}</div>
              <h2>{display.name}</h2>
              <div className="resultMeta">
                <span>{display.code}</span>
                <span>{display.type}</span>
                <span>{display.dateValue ?? '日期 N/A'}</span>
              </div>
            </div>
            <div className="signalStack">
              <div>
                <span>短期</span>
                <TrendTag label={result.analysis.shortTerm.label} />
              </div>
              <div>
                <span>中期</span>
                <TrendTag label={result.analysis.midTerm.label} />
              </div>
              <div>
                <span>{primaryBacktest ? `${primaryBacktest.horizonDays}日超额` : '历史验证'}</span>
                <strong>{fmtSignedPct(primaryBacktest?.averageExcessReturn)}</strong>
              </div>
            </div>
            <div className="resultActions">
              <button className="trackerAction" onClick={addBuyDecision} type="button">
                记录买入决策
              </button>
              <button className="trackerAction secondaryAction" onClick={addComparisonFromResult} type="button">
                加入收益对比
              </button>
            </div>
          </section>

          <div className="grid">
            <section className="card span-8">
              <div className="sectionTitle">{isStockResult(result) ? '股票基础信息' : '基金基础信息'}</div>
              <div className="kvGrid">
                <div className="kvItem"><div className="kvLabel">{isStockResult(result) ? '股票名称' : '基金名称'}</div><div className="kvValue">{display.name}</div></div>
                <div className="kvItem"><div className="kvLabel">{isStockResult(result) ? '股票代码' : '基金代码'}</div><div className="kvValue">{display.code}</div></div>
                <div className="kvItem"><div className="kvLabel">{isStockResult(result) ? '交易市场' : '基金类型'}</div><div className="kvValue">{display.type}</div></div>
                <div className="kvItem"><div className="kvLabel">{isStockResult(result) ? '成交量' : '成立时间'}</div><div className="kvValue">{isStockResult(result) ? fmtIndexPoint(result.basic?.latestVolume) : result.basic?.establishDate ?? 'N/A'}</div></div>
                <div className="kvItem"><div className="kvLabel">{display.orgLabel}</div><div className="kvValue">{display.orgValue}</div></div>
                <div className="kvItem"><div className="kvLabel">{display.managerLabel}</div><div className="kvValue">{display.managerValue}</div></div>
                <div className="kvItem"><div className="kvLabel">{display.latestLabel}</div><div className="kvValue">{fmtNum(display.latestValue)}</div></div>
                <div className="kvItem"><div className="kvLabel">{display.dateLabel}</div><div className="kvValue">{display.dateValue ?? 'N/A'}</div></div>
              </div>
            </section>

            <section className="card span-4">
              <div className="sectionTitle">阶段收益</div>
              <div className="small returnNote">按当前交易日回推自然区间，并取回推日之前最近可用交易日计算。</div>
              <div className="kvGrid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <div className="kvItem"><div className="kvLabel">近一日</div><div className="kvValue">{fmtPct(result.basic?.returns.day1)}</div></div>
                <div className="kvItem"><div className="kvLabel">近一周</div><div className="kvValue">{fmtPct(result.basic?.returns.week1)}</div></div>
                <div className="kvItem"><div className="kvLabel">近一月</div><div className="kvValue">{fmtPct(result.basic?.returns.month1)}</div></div>
                <div className="kvItem"><div className="kvLabel">近三月</div><div className="kvValue">{fmtPct(result.basic?.returns.month3)}</div></div>
                <div className="kvItem"><div className="kvLabel">近六月</div><div className="kvValue">{fmtPct(result.basic?.returns.month6)}</div></div>
                <div className="kvItem"><div className="kvLabel">近一年</div><div className="kvValue">{fmtPct(result.basic?.returns.year1)}</div></div>
              </div>
            </section>

            <section className="card span-8">
              <div className="sectionTitle">{isStockResult(result) ? '股价走势' : '净值走势'}</div>
              <div className="pillRow">
                {RANGE_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    className={`pill ${range === item.key ? 'active' : ''}`}
                    onClick={() => setRange(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {currentSeries.length ? (
                <NavChart data={currentSeries} title={isStockResult(result) ? '收盘价' : '单位净值'} />
              ) : (
                <div className="notice">该区间暂无足够可视化数据。</div>
              )}
              <div className="small">
                已接入{result.primaryBenchmark?.name ?? '沪深300'}历史序列，图中基准线按当前区间首个共同交易日归一化到{isStockResult(result) ? '股票价格' : '基金净值'}水平。
              </div>
            </section>

            <section className="card span-4">
              <div className="sectionTitle">趋势结论</div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div className="kvItem">
                  <div className="kvLabel">短期趋势（未来 3–10 个交易日倾向）</div>
                  <div className="kvValue"><TrendTag label={result.analysis.shortTerm.label} /></div>
                  <div className="small">置信度：{result.analysis.shortTerm.confidence}</div>
                </div>
                <div className="kvItem">
                  <div className="kvLabel">中期趋势（未来 1–3 个月倾向）</div>
                  <div className="kvValue"><TrendTag label={result.analysis.midTerm.label} /></div>
                  <div className="small">置信度：{result.analysis.midTerm.confidence}</div>
                </div>
                {result.analysis.degraded ? (
                  <div className="error">{result.analysis.degradedReason}</div>
                ) : null}
              </div>
            </section>

            {!isStockResult(result) && result.holdingAnalysis ? (
              <section className="card span-12">
                <div className="moduleHeader">
                  <div>
                    <div className="sectionTitle">重仓公司多维判断</div>
                    <div className="small">
                      基于最近披露的前十大重仓股，从持仓占比、估值、行业概念、政策敏感度和公司规模进行辅助判断。
                    </div>
                  </div>
                  <TrendTag label={result.holdingAnalysis.overallLabel === '中性' ? '震荡' : result.holdingAnalysis.overallLabel} />
                </div>
                <div className="holdingSummary">
                  <div>
                    <span>基金结构</span>
                    <strong>{result.holdingAnalysis.structureType}</strong>
                  </div>
                  <div>
                    <span>持仓口径</span>
                    <strong>{result.holdingAnalysis.holdingScope}</strong>
                  </div>
                  <div>
                    <span>报告期</span>
                    <strong>{result.holdingAnalysis.reportDate ?? 'N/A'}</strong>
                  </div>
                  <div>
                    <span>前十大占比</span>
                    <strong>{fmtPct(result.holdingAnalysis.topHoldingWeight)}</strong>
                  </div>
                  <div>
                    <span>集中度</span>
                    <strong>{result.holdingAnalysis.concentrationLabel}</strong>
                  </div>
                </div>
                <div className="notice holdingNotice">{result.holdingAnalysis.summary}</div>
                {result.holdingAnalysis.holdings.length ? (
                  <div className="holdingTableWrap">
                    <table className="holdingTable">
                      <thead>
                        <tr>
                          <th>重仓公司</th>
                          <th>占净值</th>
                          <th>行业</th>
                          <th>PE</th>
                          <th>PB</th>
                          <th>估值</th>
                          <th>政策敏感</th>
                          <th>判断</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.holdingAnalysis.holdings.map((item) => (
                          <tr key={`${item.secid ?? item.code}-${item.name}`}>
                            <td>
                              <strong>{item.name}</strong>
                              <span className="inlineMeta">{item.code} · 市值 {fmtLargeMoney(item.marketCap)}</span>
                            </td>
                            <td>{fmtPct(item.weightPct)}</td>
                            <td>
                              {item.industry ?? 'N/A'}
                              {item.concepts?.length ? <span className="conceptLine">{item.concepts.slice(0, 3).join(' / ')}</span> : null}
                            </td>
                            <td>{fmtIndexPoint(item.pe)}</td>
                            <td>{fmtIndexPoint(item.pb)}</td>
                            <td>{item.valuationLabel}</td>
                            <td>{item.policySensitivity}</td>
                            <td>{item.comment}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="emptyState">当前未获取到可用重仓明细。若这是 ETF 或 ETF 联接基金，请优先查看目标 ETF、指数成分股或基金公告。</div>
                )}
                <ul className="list holdingRisks">
                  {result.holdingAnalysis.risks.map((item, idx) => <li key={idx}>{item}</li>)}
                </ul>
              </section>
            ) : null}

            <section className="card span-12">
              <div className="moduleHeader">
                <div>
                  <div className="sectionTitle">历史验证</div>
                  <div className="small">
                    使用历史滚动回放验证当前同类信号，只用信号日前可见数据，扣除估算往返成本 {((result.backtest?.costBps ?? 0) / 100).toFixed(2)}%，并对比{result.backtest?.benchmark?.name ?? '主基准'}。
                  </div>
                </div>
              </div>
              {result.backtest?.ok ? (
                <div className="backtestTableWrap">
                  <table className="backtestTable">
                    <thead>
                      <tr>
                        <th>持有期</th>
                        <th>当前信号</th>
                        <th>历史样本</th>
                        <th>正收益率</th>
                        <th>平均收益</th>
                        <th>基准平均</th>
                        <th>平均超额</th>
                        <th>超额胜率</th>
                        <th>平均最大回撤</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.backtest.horizons.map((item) => (
                        <tr key={`${item.signalType}-${item.horizonDays}`}>
                          <td>{item.horizonDays} 个交易日</td>
                          <td>
                            <TrendTag label={item.signalLabel} />
                            <span className="inlineMeta">{signalTypeLabel(item.signalType)}</span>
                          </td>
                          <td>{item.sampleSize} / {item.allSampleSize}</td>
                          <td>{fmtPct(item.positiveRate)}</td>
                          <td>{fmtSignedPct(item.averageReturn)}</td>
                          <td>{fmtSignedPct(item.averageBenchmarkReturn)}</td>
                          <td>{fmtSignedPct(item.averageExcessReturn)}</td>
                          <td>{fmtPct(item.excessPositiveRate)}</td>
                          <td>{fmtSignedPct(item.averageMaxDrawdown)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="notice">{result.backtest?.message ?? '当前历史样本不足，无法生成稳定回测结果。'}</div>
              )}
              <div className="small backtestMethod">
                {result.backtest?.methodology ?? '回测结果仅衡量历史同类信号表现，不代表未来收益承诺。'}
              </div>
            </section>

            <section className="card span-6">
              <div className="sectionTitle">基准指数</div>
              <div className="kvGrid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {result.compareIndex.map((item) => (
                  <div className="kvItem" key={item.code}>
                    <div className="kvLabel">{item.name}</div>
                    <div className="kvValue">{fmtIndexPoint(item.close)}</div>
                    <div className="small">日涨跌 {fmtSignedPct(item.changePct)}</div>
                    <div className="small">{item.date ?? '日期 N/A'} · {item.code}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card span-6">
              <div className="sectionTitle">核心依据</div>
              <ul className="list">
                {result.analysis.coreReasons.map((item, idx) => <li key={idx}>{item}</li>)}
              </ul>
            </section>

            <section className="card span-6">
              <div className="sectionTitle">风险提示</div>
              <ul className="list">
                {result.analysis.riskFactors.map((item, idx) => <li key={idx}>{item}</li>)}
              </ul>
            </section>

            <section className="card span-6">
              <div className="sectionTitle">技术指标快照</div>
              <div className="kvGrid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                {Object.entries(result.analysis.indicatorSnapshot).map(([k, v]) => (
                  <div className="kvItem" key={k}>
                    <div className="kvLabel">{k}</div>
                    <div className="kvValue">{v}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card span-6">
              <div className="sectionTitle">数据说明</div>
              <div className="small">
                <p>数据更新时间：{new Date(result.updatedAt).toLocaleString('zh-CN')}</p>
                <p>最近可用数据日期：{result.dataDate ?? 'N/A'}</p>
                <p>{'basedOnRecentAvailableData' in result ? (result.basedOnRecentAvailableData ? '当前为基于最近可用数据进行分析。' : '已获取到最新可用数据。') : '当前为基于最近可用行情进行分析。'}</p>
                <p>{result.analysis.disclaimer}</p>
              </div>
              <div className="sectionTitle" style={{ marginTop: 14 }}>数据来源</div>
              <ul className="list">
                {result.sources.map((s, idx) => <li key={idx}><strong>{s.name}：</strong>{s.desc}</li>)}
              </ul>
            </section>
          </div>
        </>
      ) : null}
    </main>
  );
}
