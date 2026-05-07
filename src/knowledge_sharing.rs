//! Cross-squad knowledge sharing and skill extraction.
//!
//! Promotes valuable agent learnings to the shared knowledge store, enables
//! cross-squad search, and extracts reusable "skills" from agent histories.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::memory::{KnowledgeEntry, KnowledgeSource, KnowledgeStore};
use crate::squad::lifecycle::{HistoryEntry, HistoryEntryType};
use crate::squad::SquadManager;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A skill extracted from agent experience — reusable compressed knowledge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub content: String,
    pub tags: Vec<String>,
    pub source_agent: String,
    pub source_squad: String,
    pub extracted_at: DateTime<Utc>,
}

/// An entry that could be promoted to shared knowledge.
#[derive(Debug, Clone)]
pub struct PromotableEntry {
    pub content: String,
    pub entry_type: String,
    pub timestamp: DateTime<Utc>,
    pub suggested_tags: Vec<String>,
}

// ---------------------------------------------------------------------------
// KnowledgeSharingManager
// ---------------------------------------------------------------------------

/// Manages knowledge sharing between squads and skill extraction.
pub struct KnowledgeSharingManager {
    knowledge_store: Arc<KnowledgeStore>,
    squad_manager: Arc<SquadManager>,
}

impl KnowledgeSharingManager {
    pub fn new(knowledge_store: Arc<KnowledgeStore>, squad_manager: Arc<SquadManager>) -> Self {
        Self {
            knowledge_store,
            squad_manager,
        }
    }

    /// Promote a specific history entry from an agent to the shared knowledge store.
    pub fn promote_learning(
        &self,
        squad_id: &str,
        agent_name: &str,
        entry_content: &str,
        tags: Vec<String>,
    ) -> Result<KnowledgeEntry> {
        let title = derive_title(entry_content);
        let source = KnowledgeSource::AgentLearning {
            agent_name: agent_name.to_string(),
            squad_id: squad_id.to_string(),
        };

        self.knowledge_store
            .add(&title, entry_content, tags, source)
    }

    /// Scan an agent's history for entries that look promotable.
    /// Returns entries with "LessonLearned" or "DecisionMade" types.
    pub fn find_promotable_entries(
        &self,
        squad_id: &str,
        agent_name: &str,
    ) -> Result<Vec<PromotableEntry>> {
        let entries = self.squad_manager.read_history(squad_id, agent_name)?;

        let promotable: Vec<PromotableEntry> = entries
            .into_iter()
            .filter(|e| is_promotable(&e.entry_type))
            .map(|e| PromotableEntry {
                suggested_tags: suggest_tags(&e.content),
                entry_type: e.entry_type.to_string(),
                content: e.content,
                timestamp: e.timestamp,
            })
            .collect();

        Ok(promotable)
    }

    /// Extract a skill from an agent's accumulated experience.
    pub fn extract_skill(
        &self,
        agent_name: &str,
        squad_id: &str,
        skill_name: &str,
        description: &str,
        content: &str,
        tags: Vec<String>,
    ) -> Result<Skill> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();

        let skill = Skill {
            id: id.clone(),
            name: skill_name.to_string(),
            description: description.to_string(),
            content: content.to_string(),
            tags: tags.clone(),
            source_agent: agent_name.to_string(),
            source_squad: squad_id.to_string(),
            extracted_at: now,
        };

        // Write to ~/.io/skills/{skill_name}.md
        let skills_dir = skills_directory()?;
        fs::create_dir_all(&skills_dir).with_context(|| {
            format!(
                "Failed to create skills directory: {}",
                skills_dir.display()
            )
        })?;

        let file_path = skills_dir.join(format!("{}.md", skill_name));
        let tags_yaml = tags
            .iter()
            .map(|t| format!("\"{t}\""))
            .collect::<Vec<_>>()
            .join(", ");

        let file_content = format!(
            "---\nname: {skill_name}\ndescription: {description}\ntags: [{tags_yaml}]\nsource_agent: {agent_name}\nsource_squad: {squad_id}\nextracted_at: {extracted_at}\n---\n\n{content}\n",
            extracted_at = now.to_rfc3339(),
        );
        fs::write(&file_path, &file_content)?;

        // Also index in knowledge store for cross-squad search
        let source = KnowledgeSource::AgentLearning {
            agent_name: agent_name.to_string(),
            squad_id: squad_id.to_string(),
        };
        let title = format!("Skill: {skill_name}");
        let _ = self.knowledge_store.add(&title, content, tags, source);

        Ok(skill)
    }

    /// Find knowledge relevant to a task from ALL squads (not just the active one).
    pub fn cross_squad_search(
        &self,
        query: &str,
        max_results: usize,
    ) -> Result<Vec<KnowledgeEntry>> {
        let mut entries = self.knowledge_store.search(query, max_results * 2)?;

        // Boost source diversity: deduplicate by squad, prefer variety
        diversify_by_squad(&mut entries, max_results);

        entries.truncate(max_results);
        Ok(entries)
    }

    /// Build context from cross-squad knowledge for injection into an agent's prompt.
    pub fn build_cross_squad_context(
        &self,
        query: &str,
        current_squad_id: &str,
        max_chars: usize,
    ) -> Result<String> {
        let entries = self.cross_squad_search(query, 10)?;

        let mut output = String::from("## Cross-Squad Knowledge\n\n");

        for entry in entries {
            let source_annotation = match &entry.source {
                KnowledgeSource::AgentLearning {
                    agent_name,
                    squad_id,
                } => {
                    let label = if squad_id == current_squad_id {
                        "same squad"
                    } else {
                        "other squad"
                    };
                    format!(" _(from {agent_name} [{label}])_")
                }
                _ => String::new(),
            };

            let section = format!(
                "### {title}{source_annotation}\n{content}\n---\n\n",
                title = entry.title,
                content = entry.content,
            );

            if output.len() + section.len() > max_chars {
                let remaining = max_chars.saturating_sub(output.len());
                if remaining > 50 {
                    let truncated = &section[..remaining.min(section.len())];
                    output.push_str(truncated);
                    output.push_str("...\n");
                }
                break;
            }

            output.push_str(&section);
        }

        Ok(output)
    }

    /// List all extracted skills.
    pub fn list_skills(&self) -> Result<Vec<Skill>> {
        let skills_dir = skills_directory()?;

        if !skills_dir.exists() {
            return Ok(Vec::new());
        }

        let mut skills = Vec::new();
        for entry in fs::read_dir(&skills_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Ok(skill) = parse_skill_file(&path) {
                    skills.push(skill);
                }
            }
        }

        skills.sort_by_key(|s| std::cmp::Reverse(s.extracted_at));
        Ok(skills)
    }

    /// Get a specific skill by name.
    pub fn get_skill(&self, name: &str) -> Result<Option<Skill>> {
        let skills_dir = skills_directory()?;
        let file_path = skills_dir.join(format!("{name}.md"));

        if !file_path.exists() {
            return Ok(None);
        }

        let skill = parse_skill_file(&file_path)?;
        Ok(Some(skill))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Returns the skills directory path (~/.io/skills/).
fn skills_directory() -> Result<PathBuf> {
    let home = dirs::home_dir().context("Could not determine home directory")?;
    Ok(home.join(".io").join("skills"))
}

/// Determine if a history entry type is worth promoting.
fn is_promotable(entry_type: &HistoryEntryType) -> bool {
    matches!(
        entry_type,
        HistoryEntryType::LessonLearned | HistoryEntryType::DecisionMade
    )
}

/// Derive a short title from entry content (first line, truncated).
fn derive_title(content: &str) -> String {
    let first_line = content.lines().next().unwrap_or("Untitled learning");
    let trimmed = first_line.trim().trim_start_matches('#').trim();
    if trimmed.len() > 80 {
        format!("{}...", &trimmed[..77])
    } else {
        trimmed.to_string()
    }
}

/// Suggest tags based on keyword analysis of content.
fn suggest_tags(content: &str) -> Vec<String> {
    let lower = content.to_lowercase();
    let keyword_tags: &[(&[&str], &str)] = &[
        (&["test", "testing", "coverage"], "testing"),
        (
            &["performance", "optimization", "latency", "benchmark"],
            "performance",
        ),
        (&["security", "auth", "vulnerability"], "security"),
        (&["architecture", "design", "pattern"], "architecture"),
        (&["api", "endpoint", "rest", "graphql"], "api"),
        (&["database", "sql", "migration", "schema"], "database"),
        (&["deploy", "ci", "cd", "pipeline"], "devops"),
        (&["error", "bug", "fix", "debug"], "debugging"),
        (&["refactor", "cleanup", "technical debt"], "refactoring"),
        (&["documentation", "docs", "readme"], "documentation"),
    ];

    let mut tags = Vec::new();
    for (keywords, tag) in keyword_tags {
        if keywords.iter().any(|kw| lower.contains(kw)) {
            tags.push(tag.to_string());
        }
    }

    if tags.is_empty() {
        tags.push("general".to_string());
    }

    tags
}

/// Diversify results by boosting entries from different squads.
fn diversify_by_squad(entries: &mut Vec<KnowledgeEntry>, target_count: usize) {
    if entries.len() <= target_count {
        return;
    }

    let mut seen_squads: Vec<String> = Vec::new();
    let mut diversified: Vec<KnowledgeEntry> = Vec::new();
    let mut remainder: Vec<KnowledgeEntry> = Vec::new();

    for entry in entries.drain(..) {
        let squad_id = match &entry.source {
            KnowledgeSource::AgentLearning { squad_id, .. } => squad_id.clone(),
            _ => "_other_".to_string(),
        };

        if !seen_squads.contains(&squad_id) || diversified.len() < target_count {
            if !seen_squads.contains(&squad_id) {
                seen_squads.push(squad_id);
            }
            diversified.push(entry);
        } else {
            remainder.push(entry);
        }
    }

    diversified.extend(remainder);
    *entries = diversified;
}

/// Parse a skill markdown file with YAML frontmatter.
fn parse_skill_file(path: &PathBuf) -> Result<Skill> {
    let raw = fs::read_to_string(path)?;

    let (frontmatter, body) =
        split_frontmatter(&raw).context("Skill file missing YAML frontmatter")?;

    let name = extract_field(&frontmatter, "name").unwrap_or_default();
    let description = extract_field(&frontmatter, "description").unwrap_or_default();
    let source_agent = extract_field(&frontmatter, "source_agent").unwrap_or_default();
    let source_squad = extract_field(&frontmatter, "source_squad").unwrap_or_default();
    let extracted_at_str = extract_field(&frontmatter, "extracted_at").unwrap_or_default();
    let tags = extract_tags(&frontmatter);

    let extracted_at = chrono::DateTime::parse_from_rfc3339(&extracted_at_str)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    Ok(Skill {
        id: Uuid::new_v4().to_string(),
        name,
        description,
        content: body.trim().to_string(),
        tags,
        source_agent,
        source_squad,
        extracted_at,
    })
}

/// Split a markdown file into (frontmatter, body) at the `---` delimiters.
fn split_frontmatter(content: &str) -> Option<(String, String)> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }

    let after_first = &trimmed[3..];
    let end_idx = after_first.find("\n---")?;
    let frontmatter = after_first[..end_idx].trim().to_string();
    let body = after_first[end_idx + 4..].to_string();

    Some((frontmatter, body))
}

/// Extract a simple `key: value` field from YAML frontmatter.
fn extract_field(frontmatter: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(&prefix) {
            let value = trimmed[prefix.len()..].trim().to_string();
            return Some(value);
        }
    }
    None
}

/// Extract tags array from frontmatter (simple bracket-based parsing).
fn extract_tags(frontmatter: &str) -> Vec<String> {
    let Some(raw) = extract_field(frontmatter, "tags") else {
        return Vec::new();
    };

    // Parse "[tag1, tag2]" or ["tag1", "tag2"]
    let inner = raw.trim_start_matches('[').trim_end_matches(']');
    inner
        .split(',')
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}
