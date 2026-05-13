import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { mkdirSync } from "fs";
import { DB_PATH, IO_HOME } from "../paths.js";

let db: BetterSqlite3.Database | null = null;
let insertCount = 0;

export function getDb(): BetterSqlite3.Database {
  if (db) return db;

  mkdirSync(IO_HOME, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS io_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS squads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      project_path TEXT NOT NULL,
      copilot_session_id TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS squad_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      squad_slug TEXT NOT NULL,
      decision TEXT NOT NULL,
      context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'unknown',
      ts DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_tasks (
      task_id TEXT PRIMARY KEY,
      agent_slug TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      result TEXT,
      origin_channel TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );
  `);

  // Migrations for existing databases
  const migrations: string[] = [
    `ALTER TABLE squads ADD COLUMN model TEXT`,
    `ALTER TABLE squads ADD COLUMN universe TEXT`,
    `CREATE TABLE IF NOT EXISTS squad_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      squad_slug TEXT NOT NULL,
      character_name TEXT NOT NULL,
      role_title TEXT NOT NULL,
      charter TEXT,
      model_tier TEXT NOT NULL DEFAULT 'medium',
      personality TEXT,
      copilot_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(squad_slug, character_name)
    )`,
    `ALTER TABLE squad_agents ADD COLUMN is_lead INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE squad_agents ADD COLUMN is_qa INTEGER NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS squad_task_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      squad_slug TEXT NOT NULL,
      reviewer_character TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      comments TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  for (const migration of migrations) {
    try {
      db.exec(migration);
    } catch {
      // Already applied — ignore
    }
  }

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getState(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM io_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setState(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO io_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function deleteState(key: string): void {
  getDb().prepare("DELETE FROM io_state WHERE key = ?").run(key);
}

export function logConversation(
  role: "user" | "assistant" | "system",
  content: string,
  source: string,
): void {
  const database = getDb();
  database
    .prepare(
      "INSERT INTO conversation_log (role, content, source) VALUES (?, ?, ?)",
    )
    .run(role, content, source);

  insertCount++;
  if (insertCount % 50 === 0) {
    database
      .prepare(
        "DELETE FROM conversation_log WHERE id NOT IN (SELECT id FROM conversation_log ORDER BY id DESC LIMIT 1000)",
      )
      .run();
  }
}

export interface ConversationEntry {
  role: string;
  content: string;
  source: string;
  ts: string;
}

export function getRecentConversation(limit = 50): ConversationEntry[] {
  const rows = getDb()
    .prepare(
      "SELECT role, content, source, ts FROM conversation_log ORDER BY id DESC LIMIT ?",
    )
    .all(limit) as ConversationEntry[];

  return rows.reverse().map((row) => ({
    ...row,
    content:
      row.content.length > 1500
        ? row.content.slice(0, 1500) + "…"
        : row.content,
  }));
}
