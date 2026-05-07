//! Filesystem scanner for Agent Skills (SKILL.md files).
//!
//! Scans standard directories for skills and parses their frontmatter
//! to build a lightweight catalog for the orchestrator.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use super::types::{SkillContent, SkillEntry, SkillScope};

/// Maximum directory depth when scanning for SKILL.md files.
const MAX_SCAN_DEPTH: usize = 4;

/// Directories to skip during scanning.
const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "__pycache__"];

/// Scan all standard skill directories and return discovered skills.
/// Project-scope skills override user-scope on name collision.
pub fn scan_all_skills(project_dir: Option<&Path>) -> Vec<SkillEntry> {
    let mut skills_by_name: HashMap<String, SkillEntry> = HashMap::new();

    // User-scope directories (loaded first, can be overridden)
    if let Some(home) = dirs::home_dir() {
        for dir in user_skill_dirs(&home) {
            if dir.is_dir() {
                for entry in scan_directory(&dir, SkillScope::User) {
                    skills_by_name.insert(entry.name.clone(), entry);
                }
            }
        }
    }

    // Project-scope directories (override user-scope)
    if let Some(project) = project_dir {
        for dir in project_skill_dirs(project) {
            if dir.is_dir() {
                for entry in scan_directory(&dir, SkillScope::Project) {
                    skills_by_name.insert(entry.name.clone(), entry);
                }
            }
        }
    }

    let mut skills: Vec<SkillEntry> = skills_by_name.into_values().collect();
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

/// User-level skill directories to scan.
fn user_skill_dirs(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".io").join("skills"),
        home.join(".agents").join("skills"),
    ]
}

/// Project-level skill directories to scan.
fn project_skill_dirs(project: &Path) -> Vec<PathBuf> {
    vec![
        project.join(".io").join("skills"),
        project.join(".agents").join("skills"),
    ]
}

/// Scan a single directory for SKILL.md files.
fn scan_directory(dir: &Path, scope: SkillScope) -> Vec<SkillEntry> {
    let mut entries = Vec::new();
    scan_recursive(dir, &scope, 0, &mut entries);
    entries
}

fn scan_recursive(dir: &Path, scope: &SkillScope, depth: usize, results: &mut Vec<SkillEntry>) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }

    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if SKIP_DIRS.contains(&dir_name) || dir_name.starts_with('.') {
                continue;
            }

            // Check if this directory contains a SKILL.md
            let skill_md = path.join("SKILL.md");
            if skill_md.is_file() {
                match parse_skill_entry(&skill_md, scope.clone()) {
                    Ok(entry) => results.push(entry),
                    Err(e) => {
                        tracing::warn!(
                            path = %skill_md.display(),
                            error = %e,
                            "Failed to parse SKILL.md"
                        );
                    }
                }
            } else {
                // Recurse into subdirectories
                scan_recursive(&path, scope, depth + 1, results);
            }
        }
    }
}

/// Parse a SKILL.md file to extract a lightweight catalog entry.
fn parse_skill_entry(path: &Path, scope: SkillScope) -> Result<SkillEntry> {
    let raw =
        fs::read_to_string(path).with_context(|| format!("Failed to read {}", path.display()))?;

    let (frontmatter, _body) =
        split_frontmatter(&raw).context("SKILL.md missing YAML frontmatter")?;

    let name =
        extract_field(&frontmatter, "name").context("SKILL.md missing required 'name' field")?;
    let description = extract_field(&frontmatter, "description")
        .context("SKILL.md missing required 'description' field")?;

    Ok(SkillEntry {
        name,
        description,
        location: path.to_path_buf(),
        scope,
    })
}

/// Parse a SKILL.md file to extract full content (for activation).
pub fn parse_skill_content(path: &Path) -> Result<SkillContent> {
    let raw =
        fs::read_to_string(path).with_context(|| format!("Failed to read {}", path.display()))?;

    let (frontmatter, body) =
        split_frontmatter(&raw).context("SKILL.md missing YAML frontmatter")?;

    let name =
        extract_field(&frontmatter, "name").context("SKILL.md missing required 'name' field")?;
    let description = extract_field(&frontmatter, "description")
        .context("SKILL.md missing required 'description' field")?;
    let license = extract_field(&frontmatter, "license");
    let compatibility = extract_field(&frontmatter, "compatibility");

    // Parse metadata block (simplified — looks for indented key: value after "metadata:")
    let metadata = extract_metadata(&frontmatter);

    // Discover resource files in the skill directory
    let skill_dir = path.parent().unwrap_or(Path::new("."));
    let resources = discover_resources(skill_dir);

    Ok(SkillContent {
        name,
        description,
        license,
        compatibility,
        metadata,
        body: body.trim().to_string(),
        resources,
    })
}

/// Discover resource files (scripts/, references/, assets/) in a skill directory.
fn discover_resources(skill_dir: &Path) -> Vec<String> {
    let resource_dirs = ["scripts", "references", "assets"];
    let mut resources = Vec::new();

    for dir_name in &resource_dirs {
        let dir = skill_dir.join(dir_name);
        if dir.is_dir() {
            collect_files_recursive(&dir, skill_dir, &mut resources);
        }
    }

    resources.sort();
    resources
}

fn collect_files_recursive(dir: &Path, base: &Path, results: &mut Vec<String>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(rel) = path.strip_prefix(base) {
                    results.push(rel.to_string_lossy().to_string());
                }
            } else if path.is_dir() {
                collect_files_recursive(&path, base, results);
            }
        }
    }
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
            let value = trimmed[prefix.len()..].trim();
            // Strip surrounding quotes if present
            let unquoted = value
                .trim_start_matches('"')
                .trim_end_matches('"')
                .trim_start_matches('\'')
                .trim_end_matches('\'');
            return Some(unquoted.to_string());
        }
    }
    None
}

/// Extract metadata block from frontmatter (key: value pairs indented under "metadata:").
fn extract_metadata(frontmatter: &str) -> HashMap<String, String> {
    let mut metadata = HashMap::new();
    let mut in_metadata = false;

    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed == "metadata:" {
            in_metadata = true;
            continue;
        }
        if in_metadata {
            // Metadata entries are indented with spaces
            if line.starts_with("  ") || line.starts_with('\t') {
                if let Some((key, value)) = trimmed.split_once(':') {
                    let k = key.trim().to_string();
                    let v = value
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'')
                        .to_string();
                    if !k.is_empty() {
                        metadata.insert(k, v);
                    }
                }
            } else {
                in_metadata = false;
            }
        }
    }

    metadata
}
