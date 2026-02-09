// Memory System — SQLite + search + embeddings + chunking + sync
// All in ONE file

import path from "node:path";
import fs from "node:fs";
import type { TinyClawConfig } from "./config/schema.js";
import { resolveMemoryDir, ensureDir } from "./config/paths.js";
import { log } from "./util/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

export interface MemoryEntry {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: Float32Array;
  createdAt: number;
  updatedAt: number;
  source?: string;
  tags?: string[];
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
  matchType: "bm25" | "cosine" | "hybrid";
}

export interface MemoryStore {
  store(content: string, metadata?: Record<string, unknown>, tags?: string[]): Promise<number>;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  get(id: number): Promise<MemoryEntry | undefined>;
  delete(id: number): Promise<boolean>;
  list(limit?: number, offset?: number): Promise<MemoryEntry[]>;
  count(): Promise<number>;
  close(): void;
}

// ══════════════════════════════════════════════
// ── SQLite Memory Store ──
// ══════════════════════════════════════════════

let db: any = null;

function getDb(config: TinyClawConfig): any {
  if (db) return db;
  const Database = require("better-sqlite3");
  const dbPath = config.memory?.dbPath ?? path.join(resolveMemoryDir(), "memory.db");
  ensureDir(path.dirname(dbPath));
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      embedding BLOB,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      source TEXT,
      tags TEXT DEFAULT '[]'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, content=memories, content_rowid=id);
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);

  // Try to load sqlite-vec for vector search
  try {
    const sqliteVec = require("sqlite-vec");
    sqliteVec.load(db);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(embedding float[1536])`);
    log.debug("sqlite-vec loaded for vector search");
  } catch {
    log.debug("sqlite-vec not available, using BM25 only");
  }

  return db;
}

function rowToEntry(row: any): MemoryEntry {
  return {
    id: row.id,
    content: row.content,
    metadata: JSON.parse(row.metadata || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source,
    tags: JSON.parse(row.tags || "[]"),
  };
}

export function createMemoryStore(config: TinyClawConfig): MemoryStore {
  const database = getDb(config);

  return {
    async store(content, metadata = {}, tags = []) {
      const result = database.prepare(
        "INSERT INTO memories (content, metadata, tags, source) VALUES (?, ?, ?, ?)",
      ).run(content, JSON.stringify(metadata), JSON.stringify(tags), metadata.source ?? null);
      log.debug(`Stored memory #${result.lastInsertRowid}`);
      return Number(result.lastInsertRowid);
    },

    async search(query, limit = 10) {
      // BM25 full-text search
      const rows = database.prepare(
        `SELECT m.*, rank FROM memories_fts f JOIN memories m ON m.id = f.rowid WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?`,
      ).all(query, limit);
      return rows.map((r: any) => ({
        entry: rowToEntry(r),
        score: -r.rank,
        matchType: "bm25" as const,
      }));
    },

    async get(id) {
      const row = database.prepare("SELECT * FROM memories WHERE id = ?").get(id);
      return row ? rowToEntry(row) : undefined;
    },

    async delete(id) {
      const result = database.prepare("DELETE FROM memories WHERE id = ?").run(id);
      return result.changes > 0;
    },

    async list(limit = 50, offset = 0) {
      const rows = database.prepare("SELECT * FROM memories ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(limit, offset);
      return rows.map(rowToEntry);
    },

    async count() {
      const row = database.prepare("SELECT COUNT(*) as cnt FROM memories").get() as { cnt: number };
      return row.cnt;
    },

    close() {
      if (db) { db.close(); db = null; }
    },
  };
}

// ══════════════════════════════════════════════
// ── Token-based Chunking ──
// ══════════════════════════════════════════════

export function chunkText(text: string, chunkSize = 512, overlap = 64): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const end = Math.min(i + chunkSize, words.length);
    chunks.push(words.slice(i, end).join(" "));
    i = end - overlap;
    if (i >= words.length - overlap) break;
  }
  if (chunks.length === 0 && text.trim()) chunks.push(text.trim());
  return chunks;
}

// ══════════════════════════════════════════════
// ── File Sync ──
// ══════════════════════════════════════════════

export async function syncFileToMemory(
  filePath: string,
  store: MemoryStore,
  config: TinyClawConfig,
): Promise<number> {
  const content = fs.readFileSync(filePath, "utf-8");
  const chunkSize = config.memory?.chunkSize ?? 512;
  const chunkOverlap = config.memory?.chunkOverlap ?? 64;
  const chunks = chunkText(content, chunkSize, chunkOverlap);
  let stored = 0;
  for (const chunk of chunks) {
    await store.store(chunk, { source: filePath, type: "file_sync" });
    stored++;
  }
  log.debug(`Synced ${stored} chunks from ${filePath}`);
  return stored;
}
