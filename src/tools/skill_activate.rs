//! Skill tools for the orchestrator: activate, search, and install skills.

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};

use super::{Tool, ToolResult};
use crate::skills;

/// Tool to activate (load) a skill's full instructions into context.
pub struct ActivateSkillTool;

#[async_trait]
impl Tool for ActivateSkillTool {
    fn name(&self) -> &str {
        "activate_skill"
    }

    fn description(&self) -> &str {
        "Load a skill's full instructions into context. Use when a task matches an available skill's description."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The name of the skill to activate (from the available_skills catalog)"
                }
            },
            "required": ["name"]
        })
    }

    async fn execute(&self, args: Value) -> Result<ToolResult> {
        let name = args["name"].as_str().unwrap_or("");
        if name.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: "Missing required parameter: name".to_string(),
                metadata: None,
            });
        }

        // Scan for the skill to find its location
        let all_skills = skills::scan_all_skills(None);
        let entry = all_skills.iter().find(|s| s.name == name);

        let Some(entry) = entry else {
            return Ok(ToolResult {
                success: false,
                output: format!("Skill '{name}' not found. Use skill_search to find skills on skills.sh, or check installed skills."),
                metadata: None,
            });
        };

        match skills::parse_skill_content(&entry.location) {
            Ok(content) => {
                let mut output = format!("<skill_content name=\"{}\">\n", content.name);
                output.push_str(&content.body);
                output.push('\n');

                if !content.resources.is_empty() {
                    output.push_str("\n<skill_resources>\n");
                    for resource in &content.resources {
                        output.push_str(&format!("  <file>{resource}</file>\n"));
                    }
                    output.push_str("</skill_resources>\n");
                }

                output.push_str("</skill_content>");

                Ok(ToolResult {
                    success: true,
                    output,
                    metadata: None,
                })
            }
            Err(e) => Ok(ToolResult {
                success: false,
                output: format!("Failed to load skill '{name}': {e}"),
                metadata: None,
            }),
        }
    }
}

/// Tool to search the skills.sh registry.
pub struct SkillSearchTool;

#[async_trait]
impl Tool for SkillSearchTool {
    fn name(&self) -> &str {
        "skill_search"
    }

    fn description(&self) -> &str {
        "Search the skills.sh registry for community skills. Returns skill names, descriptions, and install counts."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query (e.g., 'pdf processing', 'data analysis', 'web scraping')"
                }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, args: Value) -> Result<ToolResult> {
        let query = args["query"].as_str().unwrap_or("");
        if query.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: "Missing required parameter: query".to_string(),
                metadata: None,
            });
        }

        match skills::registry::search_skills(query, 10).await {
            Ok(results) => {
                if results.is_empty() {
                    return Ok(ToolResult {
                        success: true,
                        output: format!("No skills found for '{query}'"),
                        metadata: None,
                    });
                }

                let mut output = format!("Found {} skills:\n\n", results.len());
                for skill in &results {
                    output.push_str(&format!(
                        "- **{}** (source: {}, {} installs)\n  Install with: skill_install {{ \"spec\": \"{}@{}\" }}\n\n",
                        skill.name, skill.source, skill.installs, skill.source, skill.id
                    ));
                }

                Ok(ToolResult {
                    success: true,
                    output,
                    metadata: None,
                })
            }
            Err(e) => Ok(ToolResult {
                success: false,
                output: format!("Search failed: {e}"),
                metadata: None,
            }),
        }
    }
}

/// Tool to install a skill from the skills.sh registry.
pub struct SkillInstallTool;

#[async_trait]
impl Tool for SkillInstallTool {
    fn name(&self) -> &str {
        "skill_install"
    }

    fn description(&self) -> &str {
        "Install a skill from the skills.sh registry. The skill will be available after installation."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "spec": {
                    "type": "string",
                    "description": "Install specifier in format 'owner/repo@slug' (e.g., 'anthropics/skills@pdf')"
                }
            },
            "required": ["spec"]
        })
    }

    async fn execute(&self, args: Value) -> Result<ToolResult> {
        let spec = args["spec"].as_str().unwrap_or("");
        if spec.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: "Missing required parameter: spec (format: owner/repo@slug)".to_string(),
                metadata: None,
            });
        }

        let (owner, repo, slug) = match skills::registry::parse_install_spec(spec) {
            Ok(parts) => parts,
            Err(e) => {
                return Ok(ToolResult {
                    success: false,
                    output: format!("Invalid spec '{spec}': {e}"),
                    metadata: None,
                });
            }
        };

        match skills::registry::install_skill(&owner, &repo, &slug).await {
            Ok(path) => Ok(ToolResult {
                success: true,
                output: format!(
                    "Installed skill '{slug}' to {}. Use activate_skill to load it.",
                    path.display()
                ),
                metadata: None,
            }),
            Err(e) => Ok(ToolResult {
                success: false,
                output: format!("Failed to install: {e}"),
                metadata: None,
            }),
        }
    }
}
