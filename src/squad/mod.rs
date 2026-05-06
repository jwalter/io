//! Squad management: create, recall, persist, and evolve agent teams.

pub mod lifecycle;

pub use lifecycle::{
    AgentTransition, CharterTemplate, CoverageReport, HireSuggestion, HistoryEntry,
    HistoryEntryType,
};

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use chrono::Utc;
use uuid::Uuid;

use crate::db::Database;
use crate::models::{Agent, AgentStatus, Squad};

pub struct SquadManager {
    data_dir: PathBuf,
    pub(crate) db: Arc<Database>,
}

impl SquadManager {
    pub fn new(data_dir: PathBuf, db: Arc<Database>) -> Self {
        Self { data_dir, db }
    }

    /// Returns the squads directory: {data_dir}/squads/
    fn squads_dir(&self) -> PathBuf {
        self.data_dir.join("squads")
    }

    /// Returns the directory for a specific squad
    fn squad_dir(&self, project_slug: &str) -> PathBuf {
        self.squads_dir().join(project_slug)
    }

    /// Returns the agents directory for a squad
    pub(crate) fn agents_dir(&self, project_slug: &str) -> PathBuf {
        self.squad_dir(project_slug).join("agents")
    }

    /// Creates a new squad with directory structure and DB record.
    pub fn create_squad(&self, project_slug: &str, project_path: &str) -> Result<Squad> {
        let squad_dir = self.squad_dir(project_slug);
        let agents_dir = self.agents_dir(project_slug);

        // Create directory structure
        fs::create_dir_all(&agents_dir)
            .with_context(|| format!("Failed to create squad directory: {}", squad_dir.display()))?;

        let now = Utc::now();
        let now_str = now.to_rfc3339();
        let id = Uuid::new_v4().to_string();

        // Write squad.toml
        let squad_toml = format!(
            r#"[squad]
project_slug = "{project_slug}"
project_path = "{project_path}"
created_at = "{now_str}"
last_active_at = "{now_str}"
"#
        );
        fs::write(squad_dir.join("squad.toml"), &squad_toml)?;

        // Create empty routing.md and decisions.md
        fs::write(squad_dir.join("routing.md"), "# Routing Rules\n\n")?;
        fs::write(squad_dir.join("decisions.md"), "# Decision Log\n\n")?;

        // Insert into DB
        self.db.insert_squad(&id, project_slug, project_path, &now_str)?;

        Ok(Squad {
            id,
            project_slug: project_slug.to_string(),
            project_path: Some(project_path.to_string()),
            agents: Vec::new(),
            created_at: now,
            last_active_at: now,
        })
    }

    /// Recalls an existing squad by project slug, loading agents from disk and DB.
    pub fn recall_squad(&self, project_slug: &str) -> Result<Option<Squad>> {
        let mut squad = match self.db.get_squad_by_slug(project_slug)? {
            Some(s) => s,
            None => return Ok(None),
        };

        // Load agents from DB
        let agents = self.db.get_squad_agents(&squad.id)?;
        squad.agents = agents;

        // Update last_active_at
        let now_str = Utc::now().to_rfc3339();
        self.db.update_squad_last_active(&squad.id, &now_str)?;

        Ok(Some(squad))
    }

    /// Hires a new agent into a squad.
    pub fn hire_agent(
        &self,
        squad_id: &str,
        name: &str,
        role: &str,
        specializations: Vec<String>,
    ) -> Result<Agent> {
        // Look up the squad to get project_slug
        let squad = self.find_squad_by_id(squad_id)?;
        let agent_dir = self.agents_dir(&squad.project_slug).join(name);

        fs::create_dir_all(&agent_dir)
            .with_context(|| format!("Failed to create agent directory: {}", agent_dir.display()))?;

        let now = Utc::now();
        let now_str = now.to_rfc3339();
        let id = Uuid::new_v4().to_string();

        // Write charter.md
        let specs_yaml = specializations.join(", ");
        let specs_bullets = specializations
            .iter()
            .map(|s| format!("- {s}"))
            .collect::<Vec<_>>()
            .join("\n");

        let charter = format!(
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
- Focus on your area of expertise
- Record important decisions and learnings in your history
- Collaborate with other squad members when tasks cross boundaries
"#
        );
        fs::write(agent_dir.join("charter.md"), &charter)?;

        // Create empty history.md
        fs::write(agent_dir.join("history.md"), "# History\n\n")?;

        // Insert into DB
        let specs_csv = specializations.join(", ");
        self.db.insert_agent(&id, squad_id, name, role, &specs_csv, &now_str)?;

        Ok(Agent {
            id,
            squad_id: squad_id.to_string(),
            name: name.to_string(),
            role: role.to_string(),
            specializations,
            skills: Vec::new(),
            status: AgentStatus::Active,
            hired_at: now,
        })
    }

    /// Retires an agent (sets status to Retired, appends note to history).
    pub fn retire_agent(&self, squad_id: &str, agent_name: &str) -> Result<()> {
        self.db.update_agent_status(squad_id, agent_name, "retired")?;

        // Append retirement note to history
        let now_str = Utc::now().to_rfc3339();
        let entry = format!("## {now_str}\n\nAgent retired.\n\n");

        let squad = self.find_squad_by_id(squad_id)?;
        let history_path = self.agents_dir(&squad.project_slug).join(agent_name).join("history.md");

        if history_path.exists() {
            let mut contents = fs::read_to_string(&history_path)?;
            contents.push_str(&entry);
            fs::write(&history_path, contents)?;
        }

        Ok(())
    }

    /// Appends a timestamped entry to an agent's history.md.
    pub fn append_history(&self, squad_id: &str, agent_name: &str, entry: &str) -> Result<()> {
        let squad = self.find_squad_by_id(squad_id)?;
        let history_path = self.agents_dir(&squad.project_slug).join(agent_name).join("history.md");

        let now_str = Utc::now().to_rfc3339();
        let formatted = format!("## {now_str}\n\n{entry}\n\n");

        let mut contents = if history_path.exists() {
            fs::read_to_string(&history_path)?
        } else {
            String::from("# History\n\n")
        };
        contents.push_str(&formatted);
        fs::write(&history_path, contents)?;

        Ok(())
    }

    /// Appends a decision to the squad's decisions.md.
    pub fn append_decision(&self, squad_id: &str, title: &str, content: &str) -> Result<()> {
        let squad = self.find_squad_by_id(squad_id)?;
        let decisions_path = self.squad_dir(&squad.project_slug).join("decisions.md");

        let now_str = Utc::now().to_rfc3339();
        let formatted = format!("## {now_str} — {title}\n\n{content}\n\n---\n\n");

        let mut contents = if decisions_path.exists() {
            fs::read_to_string(&decisions_path)?
        } else {
            String::from("# Decision Log\n\n")
        };
        contents.push_str(&formatted);
        fs::write(&decisions_path, contents)?;

        Ok(())
    }

    /// Lists all squads from the database.
    pub fn list_squads(&self) -> Result<Vec<Squad>> {
        self.db.list_squads()
    }

    /// Returns all active agents for a squad.
    pub fn get_squad_agents(&self, squad_id: &str) -> Result<Vec<Agent>> {
        self.db.get_squad_agents(squad_id)
    }

    /// Helper to look up a squad by its ID.
    pub(crate) fn find_squad_by_id(&self, squad_id: &str) -> Result<Squad> {
        // Query DB directly for the squad by ID
        let squads = self.db.list_squads()?;
        squads
            .into_iter()
            .find(|s| s.id == squad_id)
            .with_context(|| format!("Squad not found: {squad_id}"))
    }
}
