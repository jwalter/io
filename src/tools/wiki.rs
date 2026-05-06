//! Wiki/Notes tool for persistent knowledge storage.

use anyhow::Result;
use async_trait::async_trait;
use chrono::Utc;
use serde_json::{json, Value};
use std::path::PathBuf;

use super::{Tool, ToolResult};

pub struct WikiTool {
    wiki_dir: PathBuf,
}

impl WikiTool {
    pub fn new() -> Self {
        let wiki_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".io-daemon")
            .join("wiki");
        Self { wiki_dir }
    }

    fn topic_to_path(&self, topic: &str) -> PathBuf {
        let filename = topic
            .to_lowercase()
            .replace(' ', "-")
            .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "");
        self.wiki_dir.join(format!("{filename}.md"))
    }
}

#[async_trait]
impl Tool for WikiTool {
    fn name(&self) -> &str {
        "wiki"
    }

    fn description(&self) -> &str {
        "Manage wiki/notes pages with YAML frontmatter for persistent knowledge storage"
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["read", "write", "list", "search"],
                    "description": "The wiki operation to perform"
                },
                "topic": {
                    "type": "string",
                    "description": "Topic/title of the wiki page"
                },
                "content": {
                    "type": "string",
                    "description": "Content to write (for write operation)"
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Tags for the wiki page"
                },
                "query": {
                    "type": "string",
                    "description": "Search query (for search operation)"
                }
            },
            "required": ["operation"]
        })
    }

    async fn execute(&self, args: Value) -> Result<ToolResult> {
        let operation = args["operation"].as_str().unwrap_or("");

        match operation {
            "read" => {
                let topic = args["topic"].as_str().unwrap_or("");
                self.read_page(topic).await
            }
            "write" => {
                let topic = args["topic"].as_str().unwrap_or("");
                let content = args["content"].as_str().unwrap_or("");
                let tags: Vec<String> = args["tags"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                self.write_page(topic, content, &tags).await
            }
            "list" => self.list_pages().await,
            "search" => {
                let query = args["query"].as_str().unwrap_or("");
                self.search_pages(query).await
            }
            _ => Ok(ToolResult {
                success: false,
                output: format!("Unknown operation: {operation}"),
                metadata: None,
            }),
        }
    }
}

impl WikiTool {
    async fn read_page(&self, topic: &str) -> Result<ToolResult> {
        let path = self.topic_to_path(topic);
        match tokio::fs::read_to_string(&path).await {
            Ok(content) => Ok(ToolResult {
                success: true,
                output: content,
                metadata: None,
            }),
            Err(_) => Ok(ToolResult {
                success: false,
                output: format!("Wiki page not found: {topic}"),
                metadata: None,
            }),
        }
    }

    async fn write_page(&self, topic: &str, content: &str, tags: &[String]) -> Result<ToolResult> {
        tokio::fs::create_dir_all(&self.wiki_dir).await?;

        let path = self.topic_to_path(topic);
        let now = Utc::now().to_rfc3339();

        let created_at = if path.exists() {
            // Preserve original created_at from existing file
            if let Ok(existing) = tokio::fs::read_to_string(&path).await {
                extract_frontmatter_field(&existing, "created_at").unwrap_or_else(|| now.clone())
            } else {
                now.clone()
            }
        } else {
            now.clone()
        };

        let tags_str = tags
            .iter()
            .map(|t| format!("\"{t}\""))
            .collect::<Vec<_>>()
            .join(", ");

        let page = format!(
            "---\ntitle: {topic}\ntags: [{tags_str}]\ncreated_at: {created_at}\nupdated_at: {now}\n---\n\n{content}\n"
        );

        tokio::fs::write(&path, &page).await?;

        Ok(ToolResult {
            success: true,
            output: format!("Wiki page '{topic}' saved."),
            metadata: None,
        })
    }

    async fn list_pages(&self) -> Result<ToolResult> {
        if !self.wiki_dir.exists() {
            return Ok(ToolResult {
                success: true,
                output: "No wiki pages found.".to_string(),
                metadata: Some(json!({ "count": 0 })),
            });
        }

        let mut pages = Vec::new();
        let mut entries = tokio::fs::read_dir(&self.wiki_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    pages.push(stem.to_string());
                }
            }
        }
        pages.sort();

        Ok(ToolResult {
            success: true,
            output: pages.join("\n"),
            metadata: Some(json!({ "count": pages.len() })),
        })
    }

    async fn search_pages(&self, query: &str) -> Result<ToolResult> {
        if !self.wiki_dir.exists() {
            return Ok(ToolResult {
                success: true,
                output: "No wiki pages found.".to_string(),
                metadata: Some(json!({ "count": 0 })),
            });
        }

        let mut matches = Vec::new();
        let mut entries = tokio::fs::read_dir(&self.wiki_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Ok(content) = tokio::fs::read_to_string(&path).await {
                    if content.to_lowercase().contains(&query.to_lowercase()) {
                        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                            matches.push(stem.to_string());
                        }
                    }
                }
            }
        }

        Ok(ToolResult {
            success: true,
            output: if matches.is_empty() {
                "No matches found.".to_string()
            } else {
                matches.join("\n")
            },
            metadata: Some(json!({ "count": matches.len() })),
        })
    }
}

fn extract_frontmatter_field(content: &str, field: &str) -> Option<String> {
    for line in content.lines() {
        if line.starts_with(&format!("{field}:")) {
            return Some(
                line.trim_start_matches(&format!("{field}:"))
                    .trim()
                    .to_string(),
            );
        }
    }
    None
}
