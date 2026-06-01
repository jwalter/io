import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import type { Logger } from 'pino';
import { createChildLogger } from '../logging/logger.js';

let db: Client;
let logger: Logger;

const MIGRATIONS: { version: number; statements: string[] }[] = [
	{
		version: 1,
		statements: [
			`CREATE TABLE IF NOT EXISTS conversations (
				id TEXT PRIMARY KEY,
				role TEXT NOT NULL,
				content TEXT NOT NULL,
				source TEXT,
				attachments TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS squads (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				project_path TEXT NOT NULL,
				repo_url TEXT,
				autonomy_tier TEXT NOT NULL DEFAULT 'medium',
				autonomy_config TEXT,
				status TEXT DEFAULT 'active',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS squad_members (
				id TEXT PRIMARY KEY,
				squad_id TEXT NOT NULL REFERENCES squads(id),
				role_name TEXT NOT NULL,
				skill_file_path TEXT,
				tools_allowed TEXT,
				is_veto_member INTEGER DEFAULT 0,
				status TEXT DEFAULT 'active',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS squad_instances (
				id TEXT PRIMARY KEY,
				squad_id TEXT NOT NULL REFERENCES squads(id),
				issue_ref TEXT,
				worktree_path TEXT,
				branch_name TEXT,
				status TEXT DEFAULT 'planning',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				completed_at DATETIME
			)`,
			`CREATE TABLE IF NOT EXISTS decisions (
				id TEXT PRIMARY KEY,
				squad_id TEXT NOT NULL REFERENCES squads(id),
				instance_id TEXT REFERENCES squad_instances(id),
				agent_role TEXT NOT NULL,
				decision_type TEXT,
				content TEXT NOT NULL,
				rationale TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS token_usage (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				squad_id TEXT REFERENCES squads(id),
				instance_id TEXT REFERENCES squad_instances(id),
				agent_role TEXT,
				model TEXT NOT NULL,
				input_tokens INTEGER NOT NULL,
				output_tokens INTEGER NOT NULL,
				estimated_cost_usd REAL,
				timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS model_pricing (
				model TEXT PRIMARY KEY,
				input_cost_per_1m REAL NOT NULL,
				output_cost_per_1m REAL NOT NULL,
				tier TEXT,
				last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS attachments (
				id TEXT PRIMARY KEY,
				message_id TEXT,
				filename TEXT NOT NULL,
				mime_type TEXT,
				size_bytes INTEGER,
				disk_path TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS agent_activity (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				squad_id TEXT REFERENCES squads(id),
				instance_id TEXT REFERENCES squad_instances(id),
				agent_role TEXT NOT NULL,
				activity_type TEXT NOT NULL,
				model_used TEXT,
				content TEXT,
				tokens_used INTEGER,
				timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS schema_version (
				version INTEGER PRIMARY KEY
			)`,
			`CREATE TABLE IF NOT EXISTS io_state (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)`,
			'INSERT INTO schema_version (version) VALUES (1)',
		],
	},
	{
		version: 2,
		statements: [
			`CREATE TABLE IF NOT EXISTS inbox_entries (
				id TEXT PRIMARY KEY,
				squad_id TEXT REFERENCES squads(id),
				instance_id TEXT REFERENCES squad_instances(id),
				kind TEXT NOT NULL,
				title TEXT NOT NULL,
				content TEXT NOT NULL,
				status TEXT DEFAULT 'unread',
				response TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				resolved_at DATETIME
			)`,
			'CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox_entries(status)',
			'CREATE INDEX IF NOT EXISTS idx_inbox_squad ON inbox_entries(squad_id)',
			'INSERT OR REPLACE INTO schema_version (version) VALUES (2)',
		],
	},
	{
		version: 3,
		statements: [
			`CREATE TABLE IF NOT EXISTS schedules (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				target_type TEXT NOT NULL,
				target_id TEXT,
				cron TEXT NOT NULL,
				prompt TEXT NOT NULL,
				enabled INTEGER DEFAULT 1,
				last_run DATETIME,
				next_run DATETIME,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			'CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled)',
			'CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run)',
			'INSERT OR REPLACE INTO schema_version (version) VALUES (3)',
		],
	},
	{
		version: 4,
		statements: [
			`CREATE TABLE IF NOT EXISTS skill_activations (
				skill_name TEXT NOT NULL,
				target_type TEXT NOT NULL,
				target_id TEXT,
				activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (skill_name, target_type, target_id)
			)`,
			'CREATE INDEX IF NOT EXISTS idx_skill_activations_target ON skill_activations(target_type, target_id)',
			'INSERT OR REPLACE INTO schema_version (version) VALUES (4)',
		],
	},
	{
		version: 5,
		statements: [
			'ALTER TABLE squads ADD COLUMN universe TEXT',
			'ALTER TABLE squad_members ADD COLUMN display_name TEXT',
			'INSERT OR REPLACE INTO schema_version (version) VALUES (5)',
		],
	},
	{
		version: 6,
		statements: [
			'ALTER TABLE squad_members ADD COLUMN persona TEXT',
			'INSERT OR REPLACE INTO schema_version (version) VALUES (6)',
		],
	},
	{
		version: 7,
		statements: [
			// Make squad_id nullable on inbox_entries
			`CREATE TABLE IF NOT EXISTS inbox_entries_new (
				id TEXT PRIMARY KEY,
				squad_id TEXT REFERENCES squads(id),
				instance_id TEXT REFERENCES squad_instances(id),
				kind TEXT NOT NULL,
				title TEXT NOT NULL,
				content TEXT NOT NULL,
				status TEXT DEFAULT 'unread',
				response TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				resolved_at DATETIME
			)`,
			`INSERT OR IGNORE INTO inbox_entries_new SELECT * FROM inbox_entries`,
			'DROP TABLE IF EXISTS inbox_entries',
			'ALTER TABLE inbox_entries_new RENAME TO inbox_entries',
			'CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox_entries(status)',
			'CREATE INDEX IF NOT EXISTS idx_inbox_squad ON inbox_entries(squad_id)',
			'INSERT OR REPLACE INTO schema_version (version) VALUES (7)',
		],
	},
	{
			version: 8,
			statements: [
				'ALTER TABLE squad_instances ADD COLUMN objective TEXT',
				'INSERT OR REPLACE INTO schema_version (version) VALUES (8)',
			],
	},
	{
			version: 9,
			statements: [
				"ALTER TABLE squads ADD COLUMN color TEXT NOT NULL DEFAULT '#38bdf8'",
				// Backfill existing squads with unique colors from the palette
				`UPDATE squads SET color = CASE
					WHEN (SELECT COUNT(*) FROM squads s2 WHERE s2.rowid < squads.rowid) % 10 = 0 THEN '#38bdf8'
					WHEN (SELECT COUNT(*) FROM squads s2 WHERE s2.rowid < squads.rowid) % 10 = 1 THEN '#a78bfa'
					WHEN (SELECT COUNT(*) FROM squads s2 WHERE s2.rowid < squads.rowid) % 10 = 2 THEN '#34d399'
					WHEN (SELECT COUNT(*) FROM squads s2 WHERE s2.rowid < squads.rowid) % 10 = 3 THEN '#f59e0b'
					WHEN (SELECT COUNT(*) FROM squads s2 WHERE s2.rowid < squads.rowid) % 10 = 4 THEN '#f87171'
					WHEN (SELECT COUNT(*) FROM squads s2 WHERE s2.rowid < squads.rowid) % 10 = 5 THEN '#06b6d4'
					WHEN (SELECT COUNT(*) FROM squads s2 WHERE s2.rowid < squads.rowid) % 10 = 6 THEN '#fb923c'
					WHEN (SELECT COUNT(*) FROM squads s2 WHERE s2.rowid < squads.rowid) % 10 = 7 THEN '#4ade80'
					WHEN (SELECT COUNT(*) FROM squads s2 WHERE s2.rowid < squads.rowid) % 10 = 8 THEN '#c084fc'
					ELSE '#facc15'
				END`,
				'INSERT OR REPLACE INTO schema_version (version) VALUES (9)',
			],
	},
	{
			version: 10,
			statements: [
				// Add type column to squad_instances (instance vs delegation)
				"ALTER TABLE squad_instances ADD COLUMN type TEXT NOT NULL DEFAULT 'instance'",
				// Add label column to agent_activity (tool name, event label)
				'ALTER TABLE agent_activity ADD COLUMN label TEXT',
				// Add status column to agent_activity (ok/error for tool results)
				'ALTER TABLE agent_activity ADD COLUMN status TEXT',
				// Index for history queries
				'CREATE INDEX IF NOT EXISTS idx_instances_status ON squad_instances(squad_id, status)',
				'CREATE INDEX IF NOT EXISTS idx_activity_instance ON agent_activity(instance_id, timestamp)',
				'INSERT OR REPLACE INTO schema_version (version) VALUES (10)',
			],
	},
];

export async function initDatabase(dataDir: string): Promise<Client> {
	logger = createChildLogger('store');
	mkdirSync(dataDir, { recursive: true });
	const dbPath = join(dataDir, 'io.db');

	db = createClient({
		url: `file:${dbPath}`,
	});

	await db.execute('PRAGMA journal_mode = WAL');
	await db.execute('PRAGMA foreign_keys = ON');

	await runMigrations();

	logger.info({ path: dbPath }, 'Database initialized');
	return db;
}

async function runMigrations(): Promise<void> {
	const currentVersion = await getCurrentVersion();

	for (const migration of MIGRATIONS) {
		if (migration.version > currentVersion) {
			logger.info({ version: migration.version }, 'Running migration');
			for (const statement of migration.statements) {
				await db.execute(statement);
			}
		}
	}
}

async function getCurrentVersion(): Promise<number> {
	try {
		const result = await db.execute(
			'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1',
		);
		if (result.rows.length > 0) {
			return result.rows[0].version as number;
		}
		return 0;
	} catch {
		return 0;
	}
}

export function getDatabase(): Client {
	if (!db) {
		throw new Error('Database not initialized. Call initDatabase() first.');
	}
	return db;
}

export function closeDatabase(): void {
	if (db) {
		db.close();
	}
}
