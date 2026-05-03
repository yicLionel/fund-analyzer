import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AssetType, DecisionItem, HistoryItem } from './types';

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
  current_price: number | null;
  current_date: string | null;
  created_at: string;
  updated_at: string | null;
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
      current_price REAL,
      current_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_histories_visitor_viewed
      ON histories(visitor_id, viewed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_decisions_visitor_created
      ON decisions(visitor_id, created_at DESC);
  `);
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
    currentPrice: row.current_price,
    currentDate: row.current_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getUserData(visitorId: string) {
  const database = getDb();
  const histories = database
    .prepare('SELECT asset_type, code, name, latest_nav, latest_nav_date, viewed_at FROM histories WHERE visitor_id = ? ORDER BY viewed_at DESC LIMIT 10')
    .all(visitorId) as unknown as HistoryRow[];
  const decisions = database
    .prepare('SELECT id, asset_type, code, name, buy_price, buy_date, current_price, "current_date", created_at, updated_at FROM decisions WHERE visitor_id = ? ORDER BY created_at DESC')
    .all(visitorId) as unknown as DecisionRow[];

  return {
    histories: histories.map(historyFromRow),
    decisions: decisions.map(decisionFromRow),
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
      INSERT INTO decisions (id, visitor_id, asset_type, code, name, buy_price, buy_date, current_price, "current_date", created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      item.id,
      visitorId,
      item.assetType,
      item.code,
      item.name,
      item.buyPrice,
      item.buyDate,
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
      SET name = ?, current_price = ?, "current_date" = ?, updated_at = ?
      WHERE visitor_id = ? AND id = ?
    `)
    .run(item.name, item.currentPrice ?? null, item.currentDate ?? null, item.updatedAt ?? null, visitorId, item.id);
}

export function deleteDecision(visitorId: string, id: string) {
  getDb().prepare('DELETE FROM decisions WHERE visitor_id = ? AND id = ?').run(visitorId, id);
}
