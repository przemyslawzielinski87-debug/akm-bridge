import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "data");

export interface SliRecord {
  id?: number;
  sliId: string;
  component: string;
  value: number;
  unit: string;
  status: string;
  timestamp: string;
  projectId: string;
  environmentId: string;
  source: string;
}

export interface SliStore {
  save(records: SliRecord[]): number;
  query(sliId: string, limit?: number, since?: string): SliRecord[];
  getRecent(sliId: string, minutes?: number): SliRecord[];
  getStats(sliId: string, minutes?: number): { count: number; avg: number; p95: number; successRate: number };
}

class BunSqliteSliStore implements SliStore {
  private db: import("bun:sqlite").Database;

  constructor(dbPath?: string) {
    const path = dbPath || join(DATA_DIR, "sli-store.db");
    const isBun = typeof Bun !== "undefined";
    if (!isBun) {
      throw new Error("SliStore requires Bun runtime");
    }
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    this.db = new Database(path, { strict: true, create: true });
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA synchronous=NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sli_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sli_id TEXT NOT NULL,
        component TEXT NOT NULL DEFAULT '',
        value REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT 'ms',
        status TEXT NOT NULL DEFAULT 'pass',
        timestamp TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT 'akm-bridge',
        environment_id TEXT NOT NULL DEFAULT 'local',
        source TEXT NOT NULL DEFAULT ''
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sli_samples_sli_id ON sli_samples(sli_id, timestamp DESC)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sli_samples_timestamp ON sli_samples(timestamp DESC)
    `);
  }

  save(records: SliRecord[]): number {
    if (records.length === 0) return 0;
    const insert = this.db.prepare(`
      INSERT INTO sli_samples (sli_id, component, value, unit, status, timestamp, project_id, environment_id, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let saved = 0;
    const tx = this.db.transaction(() => {
      for (const r of records) {
        insert.run(r.sliId, r.component, r.value, r.unit, r.status, r.timestamp, r.projectId, r.environmentId, r.source);
        saved++;
      }
    });
    tx();
    return saved;
  }

  query(sliId: string, limit = 100, since?: string): SliRecord[] {
    if (since) {
      return this.db
        .prepare(
          `SELECT * FROM sli_samples WHERE sli_id = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?`
        )
        .all(sliId, since, limit) as SliRecord[];
    }
    return this.db
      .prepare(`SELECT * FROM sli_samples WHERE sli_id = ? ORDER BY timestamp DESC LIMIT ?`)
      .all(sliId, limit) as SliRecord[];
  }

  getRecent(sliId: string, minutes = 60): SliRecord[] {
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    return this.query(sliId, 1000, since);
  }

  getStats(
    sliId: string,
    minutes = 60
  ): { count: number; avg: number; p95: number; successRate: number } {
    const records = this.getRecent(sliId, minutes);
    if (records.length === 0) return { count: 0, avg: 0, p95: 0, successRate: 0 };
    const values = records.map((r) => r.value);
    const successCount = records.filter((r) => r.status === "pass" || r.status === "healthy").length;
    const sorted = [...values].sort((a, b) => a - b);
    const p95Index = Math.ceil((95 / 100) * sorted.length) - 1;
    return {
      count: records.length,
      avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
      p95: sorted[Math.max(0, p95Index)],
      successRate: Math.round((successCount / records.length) * 10000) / 100,
    };
  }

  close(): void {
    this.db.close();
  }
}

export function createSliStore(dbPath?: string): SliStore {
  return new BunSqliteSliStore(dbPath);
}

const JSONL_PATH = join(DATA_DIR, "sli-samples.jsonl");

export class JsonlSliStore implements SliStore {
  save(records: SliRecord[]): number {
    if (records.length === 0) return 0;
    const dir = dirname(JSONL_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const r of records) {
      writeFileSync(JSONL_PATH, JSON.stringify(r) + "\n", { flag: "a" });
    }
    return records.length;
  }

  query(sliId: string, limit = 100, since?: string): SliRecord[] {
    if (!existsSync(JSONL_PATH)) return [];
    const lines = readFileSync(JSONL_PATH, "utf-8").split("\n").filter(Boolean);
    const results: SliRecord[] = [];
    for (const line of lines) {
      const r = JSON.parse(line) as SliRecord;
      if (r.sliId !== sliId) continue;
      if (since && r.timestamp < since) continue;
      results.push(r);
    }
    return results.slice(-limit);
  }

  getRecent(sliId: string, minutes = 60): SliRecord[] {
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    return this.query(sliId, 1000, since);
  }

  getStats(
    sliId: string,
    minutes = 60
  ): { count: number; avg: number; p95: number; successRate: number } {
    const records = this.getRecent(sliId, minutes);
    if (records.length === 0) return { count: 0, avg: 0, p95: 0, successRate: 0 };
    const values = records.map((r) => r.value);
    const successCount = records.filter((r) => r.status === "pass" || r.status === "healthy").length;
    const sorted = [...values].sort((a, b) => a - b);
    const p95Index = Math.ceil((95 / 100) * sorted.length) - 1;
    return {
      count: records.length,
      avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
      p95: sorted[Math.max(0, p95Index)],
      successRate: Math.round((successCount / records.length) * 10000) / 100,
    };
  }
}