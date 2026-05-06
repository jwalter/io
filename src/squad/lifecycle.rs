//! Agent lifecycle management: charter templates, state transitions, history, and squad evolution.

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Utc};

use std::fmt;
use std::fs;

use crate::models::AgentStatus;

use super::SquadManager;

// =============================================================================
// Charter Templates
// =============================================================================

/// Template data for generating an agent charter.
pub struct CharterTemplate {
    pub name: String,
    pub role: String,
    pub specializations: Vec<String>,
    pub project_context: Option<String>,
    pub team_context: Option<String>,
}

impl CharterTemplate {
    /// Render the charter to markdown with YAML frontmatter.
    pub fn render(&self) -> String {
        let now_str = Utc::now().to_rfc3339();
        let specs_yaml = self.specializations.join(", ");
        let specs_bullets = self
            .specializations
            .iter()
            .map(|s| format!("- {s}"))
            .collect::<Vec<_>>()
            .join("\n");

        let role_guidance = role_specific_guidance(&self.role);

        let project_section = match &self.project_context {
            Some(ctx) => format!("\n## Project Context\n\n{ctx}\n"),
            None => String::new(),
        };

        let team_section = match &self.team_context {
            Some(ctx) => format!("\n## Team Context\n\n{ctx}\n"),
            None => String::new(),
        };

        format!(
            r#"---
name: {name}
role: {role}
specializations: [{specs_yaml}]
status: active
hired_at: {now_str}
---

# {name}

## Role

{role}

## Specializations

{specs_bullets}

## Guidelines

### Standard

- Focus on your area of expertise
- Record important decisions and learnings in your history
- Collaborate with other squad members when tasks cross boundaries
- Keep charter and history files up to date

### Role-Specific

{role_guidance}
{project_section}{team_section}"#,
            name = self.name,
            role = self.role,
        )
    }
}

/// Returns role-specific guidance bullets based on the role name.
fn role_specific_guidance(role: &str) -> String {
    let lower = role.to_lowercase();
    if lower.contains("architect") {
        "- Prioritize system-wide consistency and maintainability\n\
         - Document architectural decisions with rationale\n\
         - Review cross-cutting concerns proactively"
            .to_string()
    } else if lower.contains("test") || lower.contains("qa") {
        "- Ensure test coverage for critical paths\n\
         - Document test strategies and edge cases\n\
         - Report regressions and flaky tests promptly"
            .to_string()
    } else if lower.contains("security") {
        "- Audit for vulnerabilities in all changes\n\
         - Follow principle of least privilege\n\
         - Document threat models and mitigations"
            .to_string()
    } else if lower.contains("devops") || lower.contains("infra") {
        "- Automate repetitive operational tasks\n\
         - Monitor system health and performance\n\
         - Document runbooks for incident response"
            .to_string()
    } else {
        "- Write clean, well-documented code\n\
         - Follow established project conventions\n\
         - Seek review from peers for complex changes"
            .to_string()
    }
}

// =============================================================================
// Agent State Machine
// =============================================================================

/// Valid state transitions for agents.
#[derive(Debug, Clone, PartialEq)]
pub enum AgentTransition {
    /// Idle -> Active
    Activate,
    /// Active -> Idle
    Deactivate,
    /// Any -> Retired
    Retire,
}

impl fmt::Display for AgentTransition {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentTransition::Activate => write!(f, "Activate"),
            AgentTransition::Deactivate => write!(f, "Deactivate"),
            AgentTransition::Retire => write!(f, "Retire"),
        }
    }
}

/// Validates whether a state transition is legal from the given status.
fn validate_transition(current: &AgentStatus, transition: &AgentTransition) -> Result<AgentStatus> {
    match (current, transition) {
        (AgentStatus::Idle, AgentTransition::Activate) => Ok(AgentStatus::Active),
        (AgentStatus::Active, AgentTransition::Deactivate) => Ok(AgentStatus::Idle),
        (AgentStatus::Retired, AgentTransition::Retire) => {
            bail!("Agent is already retired")
        }
        (_, AgentTransition::Retire) => Ok(AgentStatus::Retired),
        (AgentStatus::Active, AgentTransition::Activate) => {
            bail!("Agent is already active")
        }
        (AgentStatus::Idle, AgentTransition::Deactivate) => {
            bail!("Agent is already idle")
        }
        (AgentStatus::Retired, _) => {
            bail!("Cannot transition a retired agent")
        }
    }
}

fn status_to_db_str(status: &AgentStatus) -> &'static str {
    match status {
        AgentStatus::Active => "active",
        AgentStatus::Idle => "idle",
        AgentStatus::Retired => "retired",
    }
}

// =============================================================================
// History Management
// =============================================================================

/// A structured history entry.
#[derive(Debug, Clone)]
pub struct HistoryEntry {
    pub timestamp: DateTime<Utc>,
    pub entry_type: HistoryEntryType,
    pub content: String,
}

/// Types of history entries.
#[derive(Debug, Clone, PartialEq)]
pub enum HistoryEntryType {
    TaskCompleted,
    DecisionMade,
    LessonLearned,
    StateChange,
    Note,
}

impl fmt::Display for HistoryEntryType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HistoryEntryType::TaskCompleted => write!(f, "TaskCompleted"),
            HistoryEntryType::DecisionMade => write!(f, "DecisionMade"),
            HistoryEntryType::LessonLearned => write!(f, "LessonLearned"),
            HistoryEntryType::StateChange => write!(f, "StateChange"),
            HistoryEntryType::Note => write!(f, "Note"),
        }
    }
}

impl HistoryEntryType {
    /// Parse a string tag back into an entry type.
    pub fn from_str(s: &str) -> Option<Self> {
        match s.trim() {
            "TaskCompleted" => Some(Self::TaskCompleted),
            "DecisionMade" => Some(Self::DecisionMade),
            "LessonLearned" => Some(Self::LessonLearned),
            "StateChange" => Some(Self::StateChange),
            "Note" => Some(Self::Note),
            _ => None,
        }
    }
}

// =============================================================================
// Squad Evolution (Coverage & Hiring Suggestions)
// =============================================================================

/// Report of specialization coverage within a squad.
#[derive(Debug, Clone)]
pub struct CoverageReport {
    pub covered_specializations: Vec<String>,
    pub agent_count: usize,
    pub active_count: usize,
}

/// A suggestion for hiring a new agent.
#[derive(Debug, Clone)]
pub struct HireSuggestion {
    pub role: String,
    pub specializations: Vec<String>,
    pub rationale: String,
}

// =============================================================================
// SquadManager impl — lifecycle methods
// =============================================================================

impl SquadManager {
    /// Transition an agent's state with validation and history tracking.
    pub fn transition_agent(
        &self,
        squad_id: &str,
        agent_name: &str,
        transition: AgentTransition,
    ) -> Result<()> {
        // Look up current agent status
        let agents = self.get_squad_agents(squad_id)?;
        let agent = agents
            .iter()
            .find(|a| a.name == agent_name)
            .with_context(|| format!("Agent '{}' not found in squad '{}'", agent_name, squad_id))?;

        // Validate and get new status
        let new_status = validate_transition(&agent.status, &transition)?;

        // Update in DB
        self.db
            .update_agent_status(squad_id, agent_name, status_to_db_str(&new_status))?;

        // Append state change to history
        let entry = HistoryEntry {
            timestamp: Utc::now(),
            entry_type: HistoryEntryType::StateChange,
            content: format!(
                "State transition: {} → {} ({})",
                status_to_db_str(&agent.status),
                status_to_db_str(&new_status),
                transition,
            ),
        };
        self.append_structured_history(squad_id, agent_name, entry)?;

        Ok(())
    }

    /// Append a structured history entry to an agent's history.md.
    pub fn append_structured_history(
        &self,
        squad_id: &str,
        agent_name: &str,
        entry: HistoryEntry,
    ) -> Result<()> {
        let squad = self.find_squad_by_id(squad_id)?;
        let history_path = self
            .agents_dir(&squad.project_slug)
            .join(agent_name)
            .join("history.md");

        let timestamp_str = entry.timestamp.to_rfc3339();
        let formatted = format!(
            "## {} [{}]\n\n{}\n\n---\n\n",
            timestamp_str, entry.entry_type, entry.content
        );

        let mut contents = if history_path.exists() {
            fs::read_to_string(&history_path)?
        } else {
            String::from("# History\n\n")
        };
        contents.push_str(&formatted);
        fs::write(&history_path, contents)?;

        Ok(())
    }

    /// Read an agent's full history, parsing history.md back into structured entries.
    pub fn read_history(&self, squad_id: &str, agent_name: &str) -> Result<Vec<HistoryEntry>> {
        let squad = self.find_squad_by_id(squad_id)?;
        let history_path = self
            .agents_dir(&squad.project_slug)
            .join(agent_name)
            .join("history.md");

        if !history_path.exists() {
            return Ok(Vec::new());
        }

        let contents = fs::read_to_string(&history_path)?;
        let entries = parse_history_entries(&contents);
        Ok(entries)
    }

    /// Analyze what specializations are covered by current agents.
    pub fn coverage_analysis(&self, squad_id: &str) -> Result<CoverageReport> {
        let agents = self.get_squad_agents(squad_id)?;

        let mut covered: Vec<String> = Vec::new();
        let mut active_count = 0;

        for agent in &agents {
            if agent.status == AgentStatus::Active {
                active_count += 1;
            }
            if agent.status != AgentStatus::Retired {
                for spec in &agent.specializations {
                    let lower = spec.to_lowercase();
                    if !covered.iter().any(|c| c.to_lowercase() == lower) {
                        covered.push(spec.clone());
                    }
                }
            }
        }

        covered.sort();

        Ok(CoverageReport {
            covered_specializations: covered,
            agent_count: agents.len(),
            active_count,
        })
    }

    /// Suggest agents to hire based on a task description.
    ///
    /// Uses simple keyword-based analysis to compare the task against existing
    /// specializations and suggest new agents to fill gaps.
    pub fn suggest_hire(
        &self,
        squad_id: &str,
        task_description: &str,
    ) -> Result<Vec<HireSuggestion>> {
        let coverage = self.coverage_analysis(squad_id)?;
        let task_lower = task_description.to_lowercase();

        let keyword_roles: &[(&[&str], &str, &[&str])] = &[
            (
                &["test", "testing", "qa", "quality", "coverage"],
                "QA Engineer",
                &["testing", "test-automation", "quality-assurance"],
            ),
            (
                &["security", "auth", "vulnerability", "audit"],
                "Security Specialist",
                &[
                    "security-audit",
                    "authentication",
                    "vulnerability-assessment",
                ],
            ),
            (
                &["deploy", "ci", "cd", "pipeline", "infrastructure", "devops"],
                "DevOps Engineer",
                &["ci-cd", "deployment", "infrastructure"],
            ),
            (
                &["frontend", "ui", "ux", "css", "react", "design"],
                "Frontend Developer",
                &["frontend", "ui-development", "responsive-design"],
            ),
            (
                &["backend", "api", "database", "server"],
                "Backend Developer",
                &["backend", "api-development", "database"],
            ),
            (
                &["architecture", "design", "system", "scalability"],
                "Software Architect",
                &["system-design", "architecture", "scalability"],
            ),
            (
                &["docs", "documentation", "readme", "guide"],
                "Technical Writer",
                &["documentation", "technical-writing", "api-docs"],
            ),
            (
                &["performance", "optimization", "profiling", "benchmark"],
                "Performance Engineer",
                &["performance-optimization", "profiling", "benchmarking"],
            ),
        ];

        let covered_lower: Vec<String> = coverage
            .covered_specializations
            .iter()
            .map(|s| s.to_lowercase())
            .collect();

        let mut suggestions = Vec::new();

        for (keywords, role, specializations) in keyword_roles {
            let matches_task = keywords.iter().any(|kw| task_lower.contains(kw));
            if !matches_task {
                continue;
            }

            // Check if these specializations are already covered
            let already_covered = specializations.iter().any(|s| {
                covered_lower
                    .iter()
                    .any(|c| c.contains(s) || s.contains(c.as_str()))
            });

            if !already_covered {
                let matched_keywords: Vec<&str> = keywords
                    .iter()
                    .filter(|kw| task_lower.contains(**kw))
                    .copied()
                    .collect();

                suggestions.push(HireSuggestion {
                    role: role.to_string(),
                    specializations: specializations.iter().map(|s| s.to_string()).collect(),
                    rationale: format!(
                        "Task mentions {} but no current agent covers these specializations",
                        matched_keywords.join(", ")
                    ),
                });
            }
        }

        Ok(suggestions)
    }

    /// Generate a charter from a template and write it to disk.
    pub fn generate_charter(
        &self,
        squad_id: &str,
        agent_name: &str,
        template: &CharterTemplate,
    ) -> Result<()> {
        let squad = self.find_squad_by_id(squad_id)?;
        let agent_dir = self.agents_dir(&squad.project_slug).join(agent_name);

        if !agent_dir.exists() {
            fs::create_dir_all(&agent_dir).with_context(|| {
                format!("Failed to create agent directory: {}", agent_dir.display())
            })?;
        }

        let charter_content = template.render();
        fs::write(agent_dir.join("charter.md"), &charter_content)?;

        Ok(())
    }
}

// =============================================================================
// History parsing helpers
// =============================================================================

/// Parse history.md content into structured entries.
fn parse_history_entries(content: &str) -> Vec<HistoryEntry> {
    let mut entries = Vec::new();

    // Split on "## " to get entry blocks (skip the initial "# History" header)
    let blocks: Vec<&str> = content.split("\n## ").collect();

    for block in blocks.iter().skip(1) {
        // Each block starts with: "{timestamp} [{entry_type}]\n\n{content}\n\n---"
        // or legacy format: "{timestamp}\n\n{content}"
        let lines: Vec<&str> = block.lines().collect();
        if lines.is_empty() {
            continue;
        }

        let header = lines[0];

        // Try to parse "[EntryType]" from header
        let (timestamp_str, entry_type) = if let Some(bracket_start) = header.find('[') {
            let ts = header[..bracket_start].trim();
            let type_str = header[bracket_start + 1..].trim_end_matches(']').trim();
            let etype = HistoryEntryType::from_str(type_str).unwrap_or(HistoryEntryType::Note);
            (ts, etype)
        } else {
            (header.trim(), HistoryEntryType::Note)
        };

        // Parse timestamp
        let timestamp = match chrono::DateTime::parse_from_rfc3339(timestamp_str) {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(_) => continue,
        };

        // Collect content (skip empty lines after header, stop at "---")
        let content_lines: Vec<&str> = lines[1..]
            .iter()
            .copied()
            .skip_while(|l| l.is_empty())
            .take_while(|l| l.trim() != "---")
            .collect();

        let content = content_lines.join("\n").trim().to_string();

        entries.push(HistoryEntry {
            timestamp,
            entry_type,
            content,
        });
    }

    entries
}
