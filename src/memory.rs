//! Memory system — long-term knowledge store with context injection and episode summarization.
//!
//! Builds on the wiki tool to provide indexed, searchable, relevance-scored knowledge entries
//! stored as markdown files with YAML frontmatter and indexed via SQLite FTS5.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::Database;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A knowledge entry with metadata for relevance scoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeEntry {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub source: KnowledgeSource,
    pub relevance_score: f32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub access_count: u32,
}

/// How a knowledge entry was produced.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum KnowledgeSource {
    UserCreated,
    AgentLearning {
        agent_name: String,
        squad_id: String,
    },
    EpisodeSummary {
        session_id: String,
    },
    Imported {
        source_url: String,
    },
}

impl KnowledgeSource {
    fn type_str(&self) -> &'static str {
        match self {
            Self::UserCreated => "user_created",
            Self::AgentLearning { .. } => "agent_learning",
            Self::EpisodeSummary { .. } => "episode_summary",
            Self::Imported { .. } => "imported",
        }
    }

    fn detail_str(&self) -> Option<String> {
        match self {
            Self::UserCreated => None,
            Self::AgentLearning {
                agent_name,
                squad_id,
            } => Some(format!("{agent_name}:{squad_id}")),
            Self::EpisodeSummary { session_id } => Some(session_id.clone()),
            Self::Imported { source_url } => Some(source_url.clone()),
        }
    }

    fn from_parts(type_str: &str, detail: Option<&str>) -> Self {
        match type_str {
            "agent_learning" => {
                let (agent_name, squad_id) = detail
                    .and_then(|d| d.split_once(':'))
                    .map(|(a, s)| (a.to_string(), s.to_string()))
                    .unwrap_or_default();
                Self::AgentLearning {
                    agent_name,
                    squad_id,
                }
            }
            "episode_summary" => Self::EpisodeSummary {
                session_id: detail.unwrap_or_default().to_string(),
            },
            "imported" => Self::Imported {
                source_url: detail.unwrap_or_default().to_string(),
            },
            _ => Self::UserCreated,
        }
    }
}

// ---------------------------------------------------------------------------
// KnowledgeStore
// ---------------------------------------------------------------------------

pub struct KnowledgeStore {
    wiki_dir: PathBuf,
    db: Arc<Database>,
}

impl KnowledgeStore {
    pub fn new(wiki_dir: PathBuf, db: Arc<Database>) -> Self {
        Self { wiki_dir, db }
    }

    /// Initialize the knowledge store (create directories, run migrations).
    pub fn init(&self) -> Result<()> {
        std::fs::create_dir_all(&self.wiki_dir)?;
        std::fs::create_dir_all(self.wiki_dir.join("episodes"))?;

        self.db.conn().execute_batch(
            "
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
            ",
        )?;

        Ok(())
    }

    // ------------------------------------------------------------------
    // CRUD
    // ------------------------------------------------------------------

    /// Add a new knowledge entry (writes file + indexes in SQLite).
    pub fn add(
        &self,
        title: &str,
        content: &str,
        tags: Vec<String>,
        source: KnowledgeSource,
    ) -> Result<KnowledgeEntry> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let file_path = self.id_to_path(&id, &source);

        // Ensure parent dir exists
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Write markdown file with YAML frontmatter
        let tags_str = tags
            .iter()
            .map(|t| format!("\"{t}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let now_str = now.to_rfc3339();

        let page = format!(
            "---\nid: {id}\ntitle: {title}\ntags: [{tags_str}]\nsource_type: {source_type}\ncreated_at: {now_str}\nupdated_at: {now_str}\n---\n\n{content}\n",
            source_type = source.type_str(),
        );
        std::fs::write(&file_path, &page)?;

        // Index in SQLite
        let conn = self.db.conn();
        conn.execute(
            "INSERT INTO knowledge_index (id, title, tags, source_type, source_detail, file_path, created_at, updated_at, access_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
            params![
                id,
                title,
                tags.join(","),
                source.type_str(),
                source.detail_str(),
                file_path.to_string_lossy().to_string(),
                now_str,
                now_str,
            ],
        )?;

        conn.execute(
            "INSERT INTO knowledge_fts (rowid, title, content, tags) VALUES ((SELECT rowid FROM knowledge_index WHERE id = ?1), ?2, ?3, ?4)",
            params![id, title, content, tags.join(" ")],
        )?;

        Ok(KnowledgeEntry {
            id,
            title: title.to_string(),
            content: content.to_string(),
            tags,
            source,
            relevance_score: 0.0,
            created_at: now,
            updated_at: now,
            access_count: 0,
        })
    }

    /// Update an existing entry.
    pub fn update(&self, id: &str, content: &str, tags: Option<Vec<String>>) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.db.conn();

        // Get current entry info
        let (title, file_path, current_tags): (String, String, String) = conn.query_row(
            "SELECT title, file_path, COALESCE(tags, '') FROM knowledge_index WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;

        let tags_vec = tags.unwrap_or_else(|| {
            current_tags
                .split(',')
                .filter(|s| !s.is_empty())
                .map(|s| s.trim().to_string())
                .collect()
        });

        let tags_csv = tags_vec.join(",");
        let tags_str = tags_vec
            .iter()
            .map(|t| format!("\"{t}\""))
            .collect::<Vec<_>>()
            .join(", ");

        // Rewrite the markdown file
        let source_type: String = conn.query_row(
            "SELECT source_type FROM knowledge_index WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        let created_at: String = conn.query_row(
            "SELECT created_at FROM knowledge_index WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        let page = format!(
            "---\nid: {id}\ntitle: {title}\ntags: [{tags_str}]\nsource_type: {source_type}\ncreated_at: {created_at}\nupdated_at: {now}\n---\n\n{content}\n",
        );
        std::fs::write(&file_path, &page)?;

        // Update index
        conn.execute(
            "UPDATE knowledge_index SET tags = ?1, updated_at = ?2 WHERE id = ?3",
            params![tags_csv, now, id],
        )?;

        // Update FTS
        let rowid: i64 = conn.query_row(
            "SELECT rowid FROM knowledge_index WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        conn.execute("DELETE FROM knowledge_fts WHERE rowid = ?1", params![rowid])?;
        conn.execute(
            "INSERT INTO knowledge_fts (rowid, title, content, tags) VALUES (?1, ?2, ?3, ?4)",
            params![rowid, title, content, tags_vec.join(" ")],
        )?;

        Ok(())
    }

    /// Delete an entry.
    pub fn delete(&self, id: &str) -> Result<()> {
        let conn = self.db.conn();

        let file_path: String = conn.query_row(
            "SELECT file_path FROM knowledge_index WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        // Remove FTS entry
        let rowid: i64 = conn.query_row(
            "SELECT rowid FROM knowledge_index WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        conn.execute("DELETE FROM knowledge_fts WHERE rowid = ?1", params![rowid])?;

        // Remove index entry
        conn.execute("DELETE FROM knowledge_index WHERE id = ?1", params![id])?;

        // Remove file
        let _ = std::fs::remove_file(file_path);

        Ok(())
    }

    /// Full-text search returning entries scored by relevance.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<KnowledgeEntry>> {
        let conn = self.db.conn();

        let mut stmt = conn.prepare(
            "SELECT ki.id, ki.title, ki.tags, ki.source_type, ki.source_detail,
                    ki.file_path, ki.created_at, ki.updated_at, ki.access_count,
                    rank
             FROM knowledge_fts
             JOIN knowledge_index ki ON knowledge_fts.rowid = ki.rowid
             WHERE knowledge_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![query, limit as i64], |row| {
            Ok(SearchRow {
                id: row.get(0)?,
                title: row.get(1)?,
                tags: row.get::<_, String>(2)?,
                source_type: row.get(3)?,
                source_detail: row.get::<_, Option<String>>(4)?,
                file_path: row.get::<_, String>(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                access_count: row.get(8)?,
                rank: row.get(9)?,
            })
        })?;

        let mut entries = Vec::new();
        for row in rows {
            let row = row?;
            let content = std::fs::read_to_string(&row.file_path)
                .map(|c| extract_content_body(&c))
                .unwrap_or_default();

            let tags: Vec<String> = row
                .tags
                .split(',')
                .filter(|s| !s.is_empty())
                .map(|s| s.trim().to_string())
                .collect();

            let source =
                KnowledgeSource::from_parts(&row.source_type, row.source_detail.as_deref());

            // Compute relevance score from rank, recency, and access frequency
            let relevance = compute_relevance(row.rank, &row.updated_at, row.access_count);

            entries.push(KnowledgeEntry {
                id: row.id,
                title: row.title,
                content,
                tags,
                source,
                relevance_score: relevance,
                created_at: parse_timestamp(&row.created_at),
                updated_at: parse_timestamp(&row.updated_at),
                access_count: row.access_count,
            });
        }

        // Re-sort by our composite relevance score (descending)
        entries.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap());

        Ok(entries)
    }

    /// Get entry by ID.
    pub fn get(&self, id: &str) -> Result<Option<KnowledgeEntry>> {
        let conn = self.db.conn();

        let result = conn.query_row(
            "SELECT id, title, tags, source_type, source_detail, file_path, created_at, updated_at, access_count
             FROM knowledge_index WHERE id = ?1",
            params![id],
            |row| {
                Ok(SearchRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    tags: row.get::<_, String>(2)?,
                    source_type: row.get(3)?,
                    source_detail: row.get::<_, Option<String>>(4)?,
                    file_path: row.get::<_, String>(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                    access_count: row.get(8)?,
                    rank: 0.0,
                })
            },
        );

        match result {
            Ok(row) => {
                let content = std::fs::read_to_string(&row.file_path)
                    .map(|c| extract_content_body(&c))
                    .unwrap_or_default();

                let tags: Vec<String> = row
                    .tags
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(|s| s.trim().to_string())
                    .collect();

                let source =
                    KnowledgeSource::from_parts(&row.source_type, row.source_detail.as_deref());

                Ok(Some(KnowledgeEntry {
                    id: row.id,
                    title: row.title,
                    content,
                    tags,
                    source,
                    relevance_score: 0.0,
                    created_at: parse_timestamp(&row.created_at),
                    updated_at: parse_timestamp(&row.updated_at),
                    access_count: row.access_count,
                }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// List all entries (paginated).
    pub fn list(&self, offset: usize, limit: usize) -> Result<Vec<KnowledgeEntry>> {
        let conn = self.db.conn();

        let mut stmt = conn.prepare(
            "SELECT id, title, tags, source_type, source_detail, file_path, created_at, updated_at, access_count
             FROM knowledge_index
             ORDER BY updated_at DESC
             LIMIT ?1 OFFSET ?2",
        )?;

        let rows = stmt.query_map(params![limit as i64, offset as i64], |row| {
            Ok(SearchRow {
                id: row.get(0)?,
                title: row.get(1)?,
                tags: row.get::<_, String>(2)?,
                source_type: row.get(3)?,
                source_detail: row.get::<_, Option<String>>(4)?,
                file_path: row.get::<_, String>(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                access_count: row.get(8)?,
                rank: 0.0,
            })
        })?;

        let mut entries = Vec::new();
        for row in rows {
            let row = row?;
            let content = std::fs::read_to_string(&row.file_path)
                .map(|c| extract_content_body(&c))
                .unwrap_or_default();

            let tags: Vec<String> = row
                .tags
                .split(',')
                .filter(|s| !s.is_empty())
                .map(|s| s.trim().to_string())
                .collect();

            let source =
                KnowledgeSource::from_parts(&row.source_type, row.source_detail.as_deref());

            entries.push(KnowledgeEntry {
                id: row.id,
                title: row.title,
                content,
                tags,
                source,
                relevance_score: 0.0,
                created_at: parse_timestamp(&row.created_at),
                updated_at: parse_timestamp(&row.updated_at),
                access_count: row.access_count,
            });
        }

        Ok(entries)
    }

    /// Record an access (bumps access_count for relevance scoring).
    pub fn record_access(&self, id: &str) -> Result<()> {
        self.db.conn().execute(
            "UPDATE knowledge_index SET access_count = access_count + 1 WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Context injection
    // ------------------------------------------------------------------

    /// Find relevant knowledge entries for a given message/context.
    pub fn find_relevant(&self, query: &str, max_results: usize) -> Result<Vec<KnowledgeEntry>> {
        self.search(query, max_results)
    }

    /// Build a context string from relevant knowledge for injection into agent prompts.
    /// Truncates to fit within max_tokens (rough estimate: 1 token ≈ 4 chars).
    pub fn build_context(&self, query: &str, max_tokens: usize) -> Result<String> {
        let max_chars = max_tokens * 4;
        let entries = self.find_relevant(query, 10)?;

        let mut output = String::from("## Relevant Knowledge\n\n");

        for entry in entries {
            let section = format!(
                "### {title}\n{content}\n---\n\n",
                title = entry.title,
                content = entry.content,
            );

            if output.len() + section.len() > max_chars {
                // Try adding a truncated snippet
                let remaining = max_chars.saturating_sub(output.len());
                if remaining > 50 {
                    let truncated = &section[..remaining.min(section.len())];
                    output.push_str(truncated);
                    output.push_str("...\n");
                }
                break;
            }

            output.push_str(&section);

            // Record access for relevance boosting
            let _ = self.record_access(&entry.id);
        }

        Ok(output)
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    fn id_to_path(&self, id: &str, source: &KnowledgeSource) -> PathBuf {
        match source {
            KnowledgeSource::EpisodeSummary { .. } => {
                self.wiki_dir.join("episodes").join(format!("{id}.md"))
            }
            _ => self.wiki_dir.join(format!("{id}.md")),
        }
    }
}

// ---------------------------------------------------------------------------
// EpisodeSummarizer
// ---------------------------------------------------------------------------

/// Summarizes conversations into knowledge entries for long-term storage.
pub struct EpisodeSummarizer {
    knowledge_store: Arc<KnowledgeStore>,
    min_messages: usize,
    cooldown_secs: u64,
}

impl EpisodeSummarizer {
    pub fn new(
        knowledge_store: Arc<KnowledgeStore>,
        min_messages: usize,
        cooldown_secs: u64,
    ) -> Self {
        Self {
            knowledge_store,
            min_messages,
            cooldown_secs,
        }
    }

    /// Check if summarization should trigger based on message count and cooldown.
    pub fn should_summarize(
        &self,
        message_count: usize,
        last_summary_at: Option<DateTime<Utc>>,
    ) -> bool {
        if message_count < self.min_messages {
            return false;
        }

        if let Some(last) = last_summary_at {
            let elapsed = Utc::now().signed_duration_since(last);
            if elapsed.num_seconds() < self.cooldown_secs as i64 {
                return false;
            }
        }

        true
    }

    /// Store a summary produced from a set of messages.
    /// The actual summarization text is expected to come from an agent; this method
    /// creates the structure and persists the result.
    pub fn store_summary(
        &self,
        session_id: &str,
        summary: &str,
        topics: Vec<String>,
    ) -> Result<KnowledgeEntry> {
        let title = format!(
            "Episode Summary — {}",
            &session_id[..8.min(session_id.len())]
        );
        let source = KnowledgeSource::EpisodeSummary {
            session_id: session_id.to_string(),
        };

        self.knowledge_store.add(&title, summary, topics, source)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

struct SearchRow {
    id: String,
    title: String,
    tags: String,
    source_type: String,
    source_detail: Option<String>,
    file_path: String,
    created_at: String,
    updated_at: String,
    access_count: u32,
    rank: f64,
}

/// Extract the body content after the YAML frontmatter delimiter.
fn extract_content_body(raw: &str) -> String {
    if let Some(rest) = raw.strip_prefix("---\n") {
        if let Some(idx) = rest.find("\n---\n") {
            return rest[idx + 5..].trim().to_string();
        }
    }
    // Fallback: return all content
    raw.to_string()
}

/// Compute a composite relevance score in [0.0, 1.0].
fn compute_relevance(fts_rank: f64, updated_at: &str, access_count: u32) -> f32 {
    // FTS5 rank is negative (more negative = better match), normalize to [0, 1]
    let rank_score = (1.0 / (1.0 + fts_rank.abs())).min(1.0);

    // Recency: decay over 30 days
    let recency_score = {
        let updated = parse_timestamp(updated_at);
        let age_days = Utc::now().signed_duration_since(updated).num_days().max(0) as f64;
        (1.0 / (1.0 + age_days / 30.0)).min(1.0)
    };

    // Access frequency: logarithmic boost
    let access_score = ((access_count as f64 + 1.0).ln() / 5.0).min(1.0);

    // Weighted combination
    let score = 0.6 * rank_score + 0.25 * recency_score + 0.15 * access_score;
    score as f32
}

fn parse_timestamp(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").map(|ndt| ndt.and_utc())
        })
        .unwrap_or_else(|_| Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_content_body() {
        let raw = "---\ntitle: Test\ntags: []\n---\n\nHello world\n";
        assert_eq!(extract_content_body(raw), "Hello world");
    }

    #[test]
    fn test_knowledge_source_roundtrip() {
        let src = KnowledgeSource::AgentLearning {
            agent_name: "coder".to_string(),
            squad_id: "sq-123".to_string(),
        };
        let restored = KnowledgeSource::from_parts(src.type_str(), src.detail_str().as_deref());
        assert_eq!(src.type_str(), restored.type_str());
    }

    #[test]
    fn test_should_summarize() {
        let tmp = std::env::temp_dir().join("io_daemon_test_summarize");
        let _ = std::fs::create_dir_all(&tmp);
        let store = Arc::new(KnowledgeStore {
            wiki_dir: tmp.clone(),
            db: Arc::new(Database::init(&tmp).unwrap()),
        });
        let summarizer = EpisodeSummarizer::new(store, 5, 60);

        assert!(!summarizer.should_summarize(3, None));
        assert!(summarizer.should_summarize(10, None));
        assert!(!summarizer.should_summarize(10, Some(Utc::now())));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_compute_relevance_in_range() {
        let score = compute_relevance(-5.0, &Utc::now().to_rfc3339(), 10);
        assert!(score >= 0.0 && score <= 1.0);
    }
}
