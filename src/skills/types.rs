//! Types for the Agent Skills system.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// A discovered skill from the filesystem — lightweight catalog entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillEntry {
    /// Skill name from frontmatter (e.g., "pdf-processing")
    pub name: String,
    /// Description from frontmatter — used for LLM discovery
    pub description: String,
    /// Absolute path to the SKILL.md file
    pub location: PathBuf,
    /// Scope: user-level or project-level
    pub scope: SkillScope,
}

/// Where the skill was found.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SkillScope {
    /// Found in user-level directory (~/.io/skills/ or ~/.agents/skills/)
    User,
    /// Found in project-level directory (./.io/skills/ or ./.agents/skills/)
    Project,
}

/// Full parsed content of a SKILL.md file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillContent {
    /// Skill name from frontmatter
    pub name: String,
    /// Description from frontmatter
    pub description: String,
    /// License identifier (optional)
    pub license: Option<String>,
    /// Compatibility notes (optional)
    pub compatibility: Option<String>,
    /// Arbitrary metadata key-value pairs
    pub metadata: HashMap<String, String>,
    /// The instruction body (everything after the frontmatter)
    pub body: String,
    /// Resource files available in the skill directory
    pub resources: Vec<String>,
}

/// A skill result from the skills.sh registry search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrySkill {
    pub id: String,
    pub name: String,
    pub source: String,
    pub installs: u64,
}

/// A downloaded skill file from skills.sh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadedFile {
    pub path: String,
    pub contents: String,
}
