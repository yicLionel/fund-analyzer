import { Pool, type PoolClient } from 'pg';
import type { AssetType, ComparisonItem, DecisionItem, HistoryItem } from './types';

declare global {
  // Reuse connections across hot reloads and serverless warm invocations.
  // eslint-disable-next-line no-var
  var __fundAnalyzerPgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __fundAnalyzerSchemaReady: Promise<void> | undefined;
}

interface HistoryRow {
  asset_type: AssetType;
  code: string;
  name: string;
  latest_nav: number | string | null;
  latest_nav_date: string | null;
  viewed_at: string;
}

interface DecisionRow {
  id: string;
  asset_type: AssetType;
  code: string;
  name: string;
  buy_price: number | string;
  buy_date: string;
  buy_amount: number | string | null;
  manual_return_pct: number | string | null;
  current_price: number | string | null;
  current_nav_date: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ComparisonRow {
  id: string;
  asset_type: AssetType;
  code: string;
  name: string;
  latest_price: number | string | null;
  latest_date: string | null;
  return_day1: number | string | null;
  return_week1: number | string | null;
  return_month1: number | string | null;
  return_month3: number | string | null;
  return_month6: number | string | null;
  return_year1: number | string | null;
  updated_at: string;
}

function databaseUrl() {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!value) {
    throw new Error('缺少 DATABASE_URL 或 POSTGRES_URL。部署到 Vercel 前请先绑定 PostgreSQL 数据库。');
  }
  return value;
}

function shouldUseSsl(connectionString: string) {
  return !/localhost|127\.0\.0\.1/.test(connectionString);
}

function getPool() {
  if (globalThis.__fundAnalyzerPgPool) return globalThis.__fundAnalyzerPgPool;
  const connectionString = databaseUrl();
  globalThis.__fundAnalyzerPgPool = new Pool({
    connectionString,
    max: 5,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return globalThis.__fundAnalyzerPgPool;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureSchema() {
  if (globalThis.__fundAnalyzerSchemaReady) return globalThis.__fundAnalyzerSchemaReady;
  globalThis.__fundAnalyzerSchemaReady = getPool()
    .query(`
      CREATE TABLE IF NOT EXISTS histories (
        visitor_id TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        latest_nav DOUBLE PRECISION,
        latest_nav_date TEXT,
        viewed_at TEXT NOT NULL,
        PRIMARY KEY (visitor_id, asset_type, code)
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        buy_price DOUBLE PRECISION NOT NULL,
        buy_date TEXT NOT NULL,
        buy_amount DOUBLE PRECISION,
        manual_return_pct DOUBLE PRECISION,
        current_price DOUBLE PRECISION,
        current_nav_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS comparisons (
        id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        latest_price DOUBLE PRECISION,
        latest_date TEXT,
        return_day1 DOUBLE PRECISION,
        return_week1 DOUBLE PRECISION,
        return_month1 DOUBLE PRECISION,
        return_month3 DOUBLE PRECISION,
        return_month6 DOUBLE PRECISION,
        return_year1 DOUBLE PRECISION,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (visitor_id, id)
      );

      ALTER TABLE decisions ADD COLUMN IF NOT EXISTS buy_amount DOUBLE PRECISION;
      ALTER TABLE decisions ADD COLUMN IF NOT EXISTS manual_return_pct DOUBLE PRECISION;

      CREATE INDEX IF NOT EXISTS idx_histories_visitor_viewed
        ON histories(visitor_id, viewed_at DESC);

      CREATE INDEX IF NOT EXISTS idx_decisions_visitor_created
        ON decisions(visitor_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_comparisons_visitor_updated
        ON comparisons(visitor_id, updated_at DESC);
    `)
    .then(() => undefined);
  return globalThis.__fundAnalyzerSchemaReady;
}

function historyFromRow(row: HistoryRow): HistoryItem {
  return {
    assetType: row.asset_type,
    code: row.code,
    name: row.name,
    latestNav: toNumber(row.latest_nav),
    latestNavDate: row.latest_nav_date,
    viewedAt: row.viewed_at,
  };
}

function decisionFromRow(row: DecisionRow): DecisionItem {
  return {
    id: row.id,
    assetType: row.asset_type,
    code: row.code,
    name: row.name,
    buyPrice: toNumber(row.buy_price) ?? 0,
    buyDate: row.buy_date,
    buyAmount: toNumber(row.buy_amount),
    manualReturnPct: toNumber(row.manual_return_pct),
    currentPrice: toNumber(row.current_price),
    currentDate: row.current_nav_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function comparisonFromRow(row: ComparisonRow): ComparisonItem {
  return {
    id: row.id,
    assetType: row.asset_type,
    code: row.code,
    name: row.name,
    latestPrice: toNumber(row.latest_price),
    latestDate: row.latest_date,
    returns: {
      day1: toNumber(row.return_day1),
      week1: toNumber(row.return_week1),
      month1: toNumber(row.return_month1),
      month3: toNumber(row.return_month3),
      month6: toNumber(row.return_month6),
      year1: toNumber(row.return_year1),
    },
    updatedAt: row.updated_at,
  };
}

export async function getUserData(visitorId: string) {
  await ensureSchema();
  const pool = getPool();
  const [histories, decisions, comparisons] = await Promise.all([
    pool.query<HistoryRow>(
      'SELECT asset_type, code, name, latest_nav, latest_nav_date, viewed_at FROM histories WHERE visitor_id = $1 ORDER BY viewed_at DESC LIMIT 10',
      [visitorId]
    ),
    pool.query<DecisionRow>(
      'SELECT id, asset_type, code, name, buy_price, buy_date, buy_amount, manual_return_pct, current_price, current_nav_date, created_at, updated_at FROM decisions WHERE visitor_id = $1 ORDER BY created_at DESC',
      [visitorId]
    ),
    pool.query<ComparisonRow>(
      `
        SELECT id, asset_type, code, name, latest_price, latest_date, return_day1, return_week1, return_month1, return_month3, return_month6, return_year1, updated_at
        FROM comparisons
        WHERE visitor_id = $1
        ORDER BY updated_at DESC
      `,
      [visitorId]
    ),
  ]);

  return {
    histories: histories.rows.map(historyFromRow),
    decisions: decisions.rows.map(decisionFromRow),
    comparisons: comparisons.rows.map(comparisonFromRow),
  };
}

export async function upsertHistory(visitorId: string, item: HistoryItem) {
  await ensureSchema();
  await getPool().query(
    `
      INSERT INTO histories (visitor_id, asset_type, code, name, latest_nav, latest_nav_date, viewed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT(visitor_id, asset_type, code)
      DO UPDATE SET
        name = excluded.name,
        latest_nav = excluded.latest_nav,
        latest_nav_date = excluded.latest_nav_date,
        viewed_at = excluded.viewed_at
    `,
    [visitorId, item.assetType, item.code, item.name, item.latestNav ?? null, item.latestNavDate ?? null, item.viewedAt]
  );
}

export async function clearHistories(visitorId: string) {
  await ensureSchema();
  await getPool().query('DELETE FROM histories WHERE visitor_id = $1', [visitorId]);
}

export async function createDecision(visitorId: string, item: DecisionItem) {
  await ensureSchema();
  await getPool().query(
    `
      INSERT INTO decisions (id, visitor_id, asset_type, code, name, buy_price, buy_date, buy_amount, manual_return_pct, current_price, current_nav_date, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
    [
      item.id,
      visitorId,
      item.assetType,
      item.code,
      item.name,
      item.buyPrice,
      item.buyDate,
      item.buyAmount ?? null,
      item.manualReturnPct ?? null,
      item.currentPrice ?? null,
      item.currentDate ?? null,
      item.createdAt,
      item.updatedAt ?? null,
    ]
  );
}

export async function updateDecision(visitorId: string, item: DecisionItem) {
  await ensureSchema();
  await getPool().query(
    `
      UPDATE decisions
      SET name = $1, buy_amount = $2, manual_return_pct = $3, current_price = $4, current_nav_date = $5, updated_at = $6
      WHERE visitor_id = $7 AND id = $8
    `,
    [item.name, item.buyAmount ?? null, item.manualReturnPct ?? null, item.currentPrice ?? null, item.currentDate ?? null, item.updatedAt ?? null, visitorId, item.id]
  );
}

export async function deleteDecision(visitorId: string, id: string) {
  await ensureSchema();
  await getPool().query('DELETE FROM decisions WHERE visitor_id = $1 AND id = $2', [visitorId, id]);
}

async function upsertComparisonWithClient(client: Pool | PoolClient, visitorId: string, item: ComparisonItem) {
  await client.query(
    `
      INSERT INTO comparisons (
        id, visitor_id, asset_type, code, name, latest_price, latest_date,
        return_day1, return_week1, return_month1, return_month3, return_month6, return_year1, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT(visitor_id, id)
      DO UPDATE SET
        asset_type = excluded.asset_type,
        code = excluded.code,
        name = excluded.name,
        latest_price = excluded.latest_price,
        latest_date = excluded.latest_date,
        return_day1 = excluded.return_day1,
        return_week1 = excluded.return_week1,
        return_month1 = excluded.return_month1,
        return_month3 = excluded.return_month3,
        return_month6 = excluded.return_month6,
        return_year1 = excluded.return_year1,
        updated_at = excluded.updated_at
    `,
    [
      item.id,
      visitorId,
      item.assetType,
      item.code,
      item.name,
      item.latestPrice ?? null,
      item.latestDate ?? null,
      item.returns.day1 ?? null,
      item.returns.week1 ?? null,
      item.returns.month1 ?? null,
      item.returns.month3 ?? null,
      item.returns.month6 ?? null,
      item.returns.year1 ?? null,
      item.updatedAt,
    ]
  );
}

export async function upsertComparison(visitorId: string, item: ComparisonItem) {
  await ensureSchema();
  await upsertComparisonWithClient(getPool(), visitorId, item);
}

export async function syncComparisons(visitorId: string, items: ComparisonItem[]) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM comparisons WHERE visitor_id = $1', [visitorId]);
    for (const item of items) {
      await upsertComparisonWithClient(client, visitorId, item);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteComparison(visitorId: string, id: string) {
  await ensureSchema();
  await getPool().query('DELETE FROM comparisons WHERE visitor_id = $1 AND id = $2', [visitorId, id]);
}
