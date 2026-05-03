import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AssetType, ComparisonItem, DecisionItem, HistoryItem } from './types';

const DB_DIR = path.join(process.cwd(), '.data');
const DB_PATH = path.join(DB_DIR, 'fund-analyzer.sqlite');

let db: DatabaseSync | null = null;

interface HistoryRow {
  asset_type: AssetType;
  code: string;
  name: string;
  latest_nav: number | null;
  latest_nav_date: string | null;
  viewed_at: string;
}

interface DecisionRow {
  id: string;
  asset_type: AssetType;
  code: string;
  name: string;
  buy_price: number;
  buy_date: string;
  buy_amount: number | null;
  manual_return_pct: number | null;
  current_price: number | null;
  current_date: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ComparisonRow {
  id: string;
  asset_type: AssetType;
  code: string;
  name: string;
  latest_price: number | null;
  latest_date: string | null;
  return_day1: number | null;
  return_week1: number | null;
  return_month1: number | null;
  return_month3: number | null;
  return_month6: number | null;
  return_year1: number | null;
  updated_at: string;
}

function getDb() {
  if (db) return db;
  mkdirSync(DB_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS histories (
      visitor_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      latest_nav REAL,
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
      buy_price REAL NOT NULL,
      buy_date TEXT NOT NULL,
      buy_amount REAL,
      manual_return_pct REAL,
      current_price REAL,
      current_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS comparisons (
      id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      latest_price REAL,
      latest_date TEXT,
      return_day1 REAL,
      return_week1 REAL,
      return_month1 REAL,
      return_month3 REAL,
      return_month6 REAL,
      return_year1 REAL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (visitor_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_histories_visitor_viewed
      ON histories(visitor_id, viewed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_decisions_visitor_created
      ON decisions(visitor_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_comparisons_visitor_updated
      ON comparisons(visitor_id, updated_at DESC);
  `);
  try {
    db.exec('ALTER TABLE decisions ADD COLUMN buy_amount REAL');
  } catch {
    // Existing local databases already have this column.
  }
  try {
    db.exec('ALTER TABLE decisions ADD COLUMN manual_return_pct REAL');
  } catch {
    // Existing local databases already have this column.
  }
  return db;
}

function historyFromRow(row: HistoryRow): HistoryItem {
  return {
    assetType: row.asset_type,
    code: row.code,
    name: row.name,
    latestNav: row.latest_nav,
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
    buyPrice: row.buy_price,
    buyDate: row.buy_date,
    buyAmount: row.buy_amount,
    manualReturnPct: row.manual_return_pct,
    currentPrice: row.current_price,
    currentDate: row.current_date,
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
    latestPrice: row.latest_price,
    latestDate: row.latest_date,
    returns: {
      day1: row.return_day1,
      week1: row.return_week1,
      month1: row.return_month1,
      month3: row.return_month3,
      month6: row.return_month6,
      year1: row.return_year1,
    },
    updatedAt: row.updated_at,
  };
}

export function getUserData(visitorId: string) {
  const database = getDb();
  const histories = database
    .prepare('SELECT asset_type, code, name, latest_nav, latest_nav_date, viewed_at FROM histories WHERE visitor_id = ? ORDER BY viewed_at DESC LIMIT 10')
    .all(visitorId) as unknown as HistoryRow[];
  const decisions = database
    .prepare('SELECT id, asset_type, code, name, buy_price, buy_date, buy_amount, manual_return_pct, current_price, "current_date", created_at, updated_at FROM decisions WHERE visitor_id = ? ORDER BY created_at DESC')
    .all(visitorId) as unknown as DecisionRow[];
  const comparisons = database
    .prepare(`
      SELECT id, asset_type, code, name, latest_price, latest_date, return_day1, return_week1, return_month1, return_month3, return_month6, return_year1, updated_at
      FROM comparisons
      WHERE visitor_id = ?
      ORDER BY updated_at DESC
    `)
    .all(visitorId) as unknown as ComparisonRow[];

  return {
    histories: histories.map(historyFromRow),
    decisions: decisions.map(decisionFromRow),
    comparisons: comparisons.map(comparisonFromRow),
  };
}

export function upsertHistory(visitorId: string, item: HistoryItem) {
  getDb()
    .prepare(`
      INSERT INTO histories (visitor_id, asset_type, code, name, latest_nav, latest_nav_date, viewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(visitor_id, asset_type, code)
      DO UPDATE SET
        name = excluded.name,
        latest_nav = excluded.latest_nav,
        latest_nav_date = excluded.latest_nav_date,
        viewed_at = excluded.viewed_at
    `)
    .run(visitorId, item.assetType, item.code, item.name, item.latestNav ?? null, item.latestNavDate ?? null, item.viewedAt);
}

export function clearHistories(visitorId: string) {
  getDb().prepare('DELETE FROM histories WHERE visitor_id = ?').run(visitorId);
}

export function createDecision(visitorId: string, item: DecisionItem) {
  getDb()
    .prepare(`
      INSERT INTO decisions (id, visitor_id, asset_type, code, name, buy_price, buy_date, buy_amount, manual_return_pct, current_price, "current_date", created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
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
      item.updatedAt ?? null
    );
}

export function updateDecision(visitorId: string, item: DecisionItem) {
  getDb()
    .prepare(`
      UPDATE decisions
      SET name = ?, buy_amount = ?, manual_return_pct = ?, current_price = ?, "current_date" = ?, updated_at = ?
      WHERE visitor_id = ? AND id = ?
    `)
    .run(item.name, item.buyAmount ?? null, item.manualReturnPct ?? null, item.currentPrice ?? null, item.currentDate ?? null, item.updatedAt ?? null, visitorId, item.id);
}

export function deleteDecision(visitorId: string, id: string) {
  getDb().prepare('DELETE FROM decisions WHERE visitor_id = ? AND id = ?').run(visitorId, id);
}

export function upsertComparison(visitorId: string, item: ComparisonItem) {
  getDb()
    .prepare(`
      INSERT INTO comparisons (
        id, visitor_id, asset_type, code, name, latest_price, latest_date,
        return_day1, return_week1, return_month1, return_month3, return_month6, return_year1, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    `)
    .run(
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
      item.updatedAt
    );
}

export function syncComparisons(visitorId: string, items: ComparisonItem[]) {
  const database = getDb();
  database.prepare('DELETE FROM comparisons WHERE visitor_id = ?').run(visitorId);
  for (const item of items) {
    upsertComparison(visitorId, item);
  }
}

export function deleteComparison(visitorId: string, id: string) {
  getDb().prepare('DELETE FROM comparisons WHERE visitor_id = ? AND id = ?').run(visitorId, id);
}
