use std::path::Path;
use rusqlite::{params, Connection};
use anyhow::Result;
use chrono::{DateTime, Utc};

use crate::models::{Agent, AgentStatus, Squad};

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn init(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir)?;
        let db_path = data_dir.join("daemon.db");
        let conn = Connection::open(&db_path)?;

        let db = Self { conn };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<()> {
        self.conn.execute_batch("
            CREATE TABLE IF NOT EXISTS migrations (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                squad_id TEXT,
                agent_name TEXT,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                ended_at TEXT
            );

            CREATE TABLE IF NOT EXISTS squads (
                id TEXT PRIMARY KEY,
                project_slug TEXT NOT NULL UNIQUE,
                project_path TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS squad_agents (
                id TEXT PRIMARY KEY,
                squad_id TEXT NOT NULL REFERENCES squads(id),
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                specializations TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                hired_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        ")?;

        // Create FTS5 virtual table for full-text search on messages
        self.conn.execute_batch("
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                content,
                content_rowid='rowid',
                tokenize='porter'
            );
        ")?;

        // Knowledge index for the memory/wiki system
        self.conn.execute_batch("
            CREATE TABLE IF NOT EXISTS knowledge_index (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                tags TEXT,
                source_type TEXT NOT NULL,
                source_detail TEXT,
                file_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                access_count INTEGER DEFAULT 0
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
                title,
                content,
                tags,
                tokenize='porter'
            );
        ")?;

        Ok(())
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    // --- Squad operations ---

    pub fn insert_squad(&self, id: &str, project_slug: &str, project_path: &str, created_at: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO squads (id, project_slug, project_path, created_at, last_active_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![id, project_slug, project_path, created_at],
        )?;
        Ok(())
    }

    pub fn get_squad_by_slug(&self, project_slug: &str) -> Result<Option<Squad>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_slug, project_path, created_at, last_active_at FROM squads WHERE project_slug = ?1"
        )?;

        let result = stmt.query_row(params![project_slug], |row| {
            let created_str: String = row.get(3)?;
            let active_str: String = row.get(4)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                created_str,
                active_str,
            ))
        });

        match result {
            Ok((id, slug, path, created_str, active_str)) => {
                let created_at = DateTime::parse_from_rfc3339(&created_str)
                    .or_else(|_| chrono::NaiveDateTime::parse_from_str(&created_str, "%Y-%m-%d %H:%M:%S")
                        .map(|ndt| ndt.and_utc().fixed_offset()))
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());

                let last_active_at = DateTime::parse_from_rfc3339(&active_str)
                    .or_else(|_| chrono::NaiveDateTime::parse_from_str(&active_str, "%Y-%m-%d %H:%M:%S")
                        .map(|ndt| ndt.and_utc().fixed_offset()))
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());

                Ok(Some(Squad {
                    id,
                    project_slug: slug,
                    project_path: path,
                    agents: Vec::new(),
                    created_at,
                    last_active_at,
                }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn update_squad_last_active(&self, squad_id: &str, timestamp: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE squads SET last_active_at = ?1 WHERE id = ?2",
            params![timestamp, squad_id],
        )?;
        Ok(())
    }

    pub fn list_squads(&self) -> Result<Vec<Squad>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_slug, project_path, created_at, last_active_at FROM squads"
        )?;

        let rows = stmt.query_map([], |row| {
            let created_str: String = row.get(3)?;
            let active_str: String = row.get(4)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                created_str,
                active_str,
            ))
        })?;

        let mut squads = Vec::new();
        for row in rows {
            let (id, slug, path, created_str, active_str) = row?;
            let created_at = parse_db_timestamp(&created_str);
            let last_active_at = parse_db_timestamp(&active_str);

            squads.push(Squad {
                id,
                project_slug: slug,
                project_path: path,
                agents: Vec::new(),
                created_at,
                last_active_at,
            });
        }
        Ok(squads)
    }

    // --- Agent operations ---

    pub fn insert_agent(
        &self,
        id: &str,
        squad_id: &str,
        name: &str,
        role: &str,
        specializations: &str,
        hired_at: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO squad_agents (id, squad_id, name, role, specializations, status, hired_at) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6)",
            params![id, squad_id, name, role, specializations, hired_at],
        )?;
        Ok(())
    }

    pub fn update_agent_status(&self, squad_id: &str, agent_name: &str, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE squad_agents SET status = ?1 WHERE squad_id = ?2 AND name = ?3",
            params![status, squad_id, agent_name],
        )?;
        Ok(())
    }

    pub fn get_squad_agents(&self, squad_id: &str) -> Result<Vec<Agent>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, squad_id, name, role, specializations, status, hired_at FROM squad_agents WHERE squad_id = ?1 AND status = 'active'"
        )?;

        let rows = stmt.query_map(params![squad_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;

        let mut agents = Vec::new();
        for row in rows {
            let (id, squad_id, name, role, specs_str, status_str, hired_str) = row?;
            let specializations: Vec<String> = if specs_str.is_empty() {
                Vec::new()
            } else {
                specs_str.split(',').map(|s| s.trim().to_string()).collect()
            };
            let status = match status_str.as_str() {
                "active" => AgentStatus::Active,
                "idle" => AgentStatus::Idle,
                "retired" => AgentStatus::Retired,
                _ => AgentStatus::Active,
            };
            let hired_at = parse_db_timestamp(&hired_str);

            agents.push(Agent {
                id,
                squad_id,
                name,
                role,
                specializations,
                skills: Vec::new(),
                status,
                hired_at,
            });
        }
        Ok(agents)
    }
}

fn parse_db_timestamp(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                .map(|ndt| ndt.and_utc())
        })
        .unwrap_or_else(|_| Utc::now())
}
