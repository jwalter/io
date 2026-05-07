//! skills.sh registry client — search and download skills.

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};

use super::types::{DownloadedFile, RegistrySkill};

const SKILLS_API_BASE: &str = "https://skills.sh";

/// Search the skills.sh registry for skills matching a query.
pub async fn search_skills(query: &str, limit: usize) -> Result<Vec<RegistrySkill>> {
    if query.len() < 2 {
        return Ok(Vec::new());
    }

    let url = format!(
        "{}/api/search?q={}&limit={}",
        SKILLS_API_BASE,
        urlencoding::encode(query),
        limit
    );

    let response = reqwest::get(&url)
        .await
        .context("Failed to reach skills.sh API")?;

    if !response.status().is_success() {
        anyhow::bail!("skills.sh search returned {}", response.status());
    }

    let body: serde_json::Value = response
        .json()
        .await
        .context("Failed to parse skills.sh response")?;

    let skills = body["skills"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    Some(RegistrySkill {
                        id: s["id"].as_str()?.to_string(),
                        name: s["name"].as_str().unwrap_or_default().to_string(),
                        source: s["source"].as_str().unwrap_or_default().to_string(),
                        installs: s["installs"].as_u64().unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(skills)
}

/// Download a skill from skills.sh and install it to the local skills directory.
pub async fn install_skill(owner: &str, repo: &str, slug: &str) -> Result<PathBuf> {
    let url = format!(
        "{}/api/download/{}/{}/{}",
        SKILLS_API_BASE,
        urlencoding::encode(owner),
        urlencoding::encode(repo),
        urlencoding::encode(slug),
    );

    let response = reqwest::get(&url)
        .await
        .context("Failed to download skill from skills.sh")?;

    if !response.status().is_success() {
        anyhow::bail!("skills.sh download returned {}", response.status());
    }

    let body: serde_json::Value = response
        .json()
        .await
        .context("Failed to parse download response")?;

    let files: Vec<DownloadedFile> = body["files"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|f| {
                    Some(DownloadedFile {
                        path: f["path"].as_str()?.to_string(),
                        contents: f["contents"].as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    if files.is_empty() {
        anyhow::bail!("No files returned for skill {owner}/{repo}@{slug}");
    }

    // Install to ~/.io/skills/{slug}/
    let home = dirs::home_dir().context("Could not determine home directory")?;
    let skill_dir = home.join(".io").join("skills").join(slug);
    fs::create_dir_all(&skill_dir)
        .with_context(|| format!("Failed to create {}", skill_dir.display()))?;

    for file in &files {
        let file_path = skill_dir.join(&file.path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&file_path, &file.contents)
            .with_context(|| format!("Failed to write {}", file_path.display()))?;
    }

    tracing::info!(
        slug = slug,
        files = files.len(),
        path = %skill_dir.display(),
        "Installed skill from skills.sh"
    );

    Ok(skill_dir)
}

/// Remove an installed skill by name.
pub fn remove_skill(name: &str) -> Result<()> {
    let home = dirs::home_dir().context("Could not determine home directory")?;
    let skill_dir = home.join(".io").join("skills").join(name);

    if !skill_dir.exists() {
        anyhow::bail!("Skill '{name}' is not installed");
    }

    fs::remove_dir_all(&skill_dir)
        .with_context(|| format!("Failed to remove {}", skill_dir.display()))?;

    tracing::info!(name = name, "Removed skill");
    Ok(())
}

/// Parse an install specifier like "owner/repo@slug" into its parts.
pub fn parse_install_spec(spec: &str) -> Result<(String, String, String)> {
    // Format: owner/repo@slug
    let (source, slug) = spec
        .split_once('@')
        .context("Install spec must be in format 'owner/repo@slug'")?;

    let (owner, repo) = source
        .split_once('/')
        .context("Source must be in format 'owner/repo'")?;

    Ok((owner.to_string(), repo.to_string(), slug.to_string()))
}
