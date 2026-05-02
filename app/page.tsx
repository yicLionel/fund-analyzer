'use client';

import { useEffect, useMemo, useState } from 'react';
import NavChart from '@/components/NavChart';
import type { FundAnalysisResponse, RangeKey, StockAnalysisResponse } from '@/lib/types';

const FUND_HISTORY_STORAGE_KEY = 'fund-analyzer:fund-history';
const MAX_HISTORY_ITEMS = 10;
type AssetType = 'fund' | 'stock';
type AnalysisResponse = FundAnalysisResponse | StockAnalysisResponse;

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: '1m', label: '近一月' },
  { key: '3m', label: '近三月' },
  { key: '6m', label: '近六月' },
  { key: '1y', label: '近一年' },
];

interface FundHistoryItem {
  assetType?: AssetType;
  code: string;
  name: string;
  latestNav?: number | null;
  latestNavDate?: string | null;
  viewedAt: string;
}

function isFundHistoryItem(value: unknown): value is FundHistoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<FundHistoryItem>;
  const navValid = item.latestNav === undefined || item.latestNav === null || typeof item.latestNav === 'number';
  const navDateValid = item.latestNavDate === undefined || item.latestNavDate === null || typeof item.latestNavDate === 'string';
  return (
    typeof item.code === 'string' &&
    /^\d{6}$/.test(item.code) &&
    typeof item.name === 'string' &&
    typeof item.viewedAt === 'string' &&
    navValid &&
    navDateValid
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

function removeStoredHistory() {
  try {
    localStorage.removeItem(FUND_HISTORY_STORAGE_KEY);
  } catch {
    // Ignore storage failures so the UI remains usable when browser storage is blocked.
  }
}

function TrendTag({ label }: { label: string }) {
  const cls = label === '偏强' ? 'good' : label === '偏弱' ? 'bad' : 'warn';
  return <span className={`tag ${cls}`}>{label}</span>;
}

function signalTypeLabel(signalType: 'shortTerm' | 'midTerm') {
  return signalType === 'shortTerm' ? '短期' : '中期';
}

export default function HomePage() {
  const [assetType, setAssetType] = useState<AssetType>('fund');
  const [code, setCode] = useState('161725');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('3m');
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [history, setHistory] = useState<FundHistoryItem[]>([]);

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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FUND_HISTORY_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setHistory(parsed.filter(isFundHistoryItem).slice(0, MAX_HISTORY_ITEMS));
    } catch {
      removeStoredHistory();
    }
  }, []);

  function recordFundHistory(data: AnalysisResponse, nextAssetType: AssetType) {
    if (!data.basic) return;

    const item: FundHistoryItem = {
      assetType: nextAssetType,
      code: data.basic.code || data.code,
      name: data.basic.name || data.code,
      latestNav: isStockResult(data) ? data.basic.latestClose ?? null : data.basic.latestNav ?? null,
      latestNavDate: isStockResult(data) ? data.basic.latestDate ?? data.dataDate ?? null : data.basic.latestNavDate ?? data.dataDate ?? null,
      viewedAt: new Date().toISOString(),
    };

    setHistory((prev) => {
      const next = [item, ...prev.filter((entry) => entry.code !== item.code || (entry.assetType ?? 'fund') !== item.assetType)].slice(0, MAX_HISTORY_ITEMS);
      try {
        localStorage.setItem(FUND_HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage may be unavailable in private mode; keep in-memory history for this session.
      }
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
    removeStoredHistory();
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

      <section className="card historyCard">
        <div className="moduleHeader">
          <div>
            <div className="sectionTitle">历史查询</div>
            <div className="small">自动记录当前浏览器最近查看的基金和股票，最多保留 {MAX_HISTORY_ITEMS} 条。</div>
          </div>
          {history.length ? (
            <button className="ghostButton" onClick={clearHistory} type="button">
              清空历史
            </button>
          ) : null}
        </div>

        {history.length ? (
          <div className="historyList">
            {history.map((item) => (
              <button
                className="historyItem"
                disabled={loading}
                key={`${item.assetType ?? 'fund'}-${item.code}`}
                onClick={() => queryAsset(item.code, item.assetType ?? 'fund')}
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
      </section>

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
