//! File operations tool: read, write, list, search.

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::Path;

use super::{Tool, ToolResult};

pub struct FileOpsTool;

#[async_trait]
impl Tool for FileOpsTool {
    fn name(&self) -> &str {
        "file_ops"
    }

    fn description(&self) -> &str {
        "File system operations: read, write, list directory contents, and search files by content"
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["read", "write", "list", "search"],
                    "description": "The file operation to perform"
                },
                "path": {
                    "type": "string",
                    "description": "File or directory path"
                },
                "content": {
                    "type": "string",
                    "description": "Content to write (for write operation)"
                },
                "recursive": {
                    "type": "boolean",
                    "description": "Whether to list directories recursively",
                    "default": false
                },
                "pattern": {
                    "type": "string",
                    "description": "Search pattern (substring match)"
                },
                "glob": {
                    "type": "string",
                    "description": "Glob pattern to filter files during search"
                }
            },
            "required": ["operation", "path"]
        })
    }

    async fn execute(&self, args: Value) -> Result<ToolResult> {
        let operation = args["operation"].as_str().unwrap_or("");
        let path = args["path"].as_str().unwrap_or("");

        match operation {
            "read" => self.read_file(path).await,
            "write" => {
                let content = args["content"].as_str().unwrap_or("");
                self.write_file(path, content).await
            }
            "list" => {
                let recursive = args["recursive"].as_bool().unwrap_or(false);
                self.list_dir(path, recursive).await
            }
            "search" => {
                let pattern = args["pattern"].as_str().unwrap_or("");
                let glob = args["glob"].as_str();
                self.search_files(path, pattern, glob).await
            }
            _ => Ok(ToolResult {
                success: false,
                output: format!("Unknown operation: {operation}"),
                metadata: None,
            }),
        }
    }
}

impl FileOpsTool {
    async fn read_file(&self, path: &str) -> Result<ToolResult> {
        match tokio::fs::read_to_string(path).await {
            Ok(content) => Ok(ToolResult {
                success: true,
                output: content,
                metadata: None,
            }),
            Err(e) => Ok(ToolResult {
                success: false,
                output: format!("Failed to read file: {e}"),
                metadata: None,
            }),
        }
    }

    async fn write_file(&self, path: &str, content: &str) -> Result<ToolResult> {
        if let Some(parent) = Path::new(path).parent() {
            if !parent.exists() {
                tokio::fs::create_dir_all(parent).await?;
            }
        }
        match tokio::fs::write(path, content).await {
            Ok(()) => Ok(ToolResult {
                success: true,
                output: format!("Written {} bytes to {path}", content.len()),
                metadata: None,
            }),
            Err(e) => Ok(ToolResult {
                success: false,
                output: format!("Failed to write file: {e}"),
                metadata: None,
            }),
        }
    }

    async fn list_dir(&self, path: &str, recursive: bool) -> Result<ToolResult> {
        let entries = if recursive {
            self.list_recursive(Path::new(path))?
        } else {
            self.list_shallow(Path::new(path))?
        };

        Ok(ToolResult {
            success: true,
            output: entries.join("\n"),
            metadata: Some(json!({ "count": entries.len() })),
        })
    }

    fn list_shallow(&self, path: &Path) -> Result<Vec<String>> {
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let file_type = if entry.file_type()?.is_dir() {
                "dir"
            } else {
                "file"
            };
            entries.push(format!("[{file_type}] {}", entry.path().display()));
        }
        entries.sort();
        Ok(entries)
    }

    fn list_recursive(&self, path: &Path) -> Result<Vec<String>> {
        let mut entries = Vec::new();
        self.walk_dir(path, &mut entries)?;
        entries.sort();
        Ok(entries)
    }

    fn walk_dir(&self, path: &Path, entries: &mut Vec<String>) -> Result<()> {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();
            let file_type = if entry_path.is_dir() { "dir" } else { "file" };
            entries.push(format!("[{file_type}] {}", entry_path.display()));
            if entry_path.is_dir() {
                self.walk_dir(&entry_path, entries)?;
            }
        }
        Ok(())
    }

    async fn search_files(
        &self,
        path: &str,
        pattern: &str,
        glob: Option<&str>,
    ) -> Result<ToolResult> {
        let mut matches = Vec::new();
        self.search_recursive(Path::new(path), pattern, glob, &mut matches)?;

        if matches.is_empty() {
            Ok(ToolResult {
                success: true,
                output: "No matches found.".to_string(),
                metadata: Some(json!({ "count": 0 })),
            })
        } else {
            let count = matches.len();
            Ok(ToolResult {
                success: true,
                output: matches.join("\n"),
                metadata: Some(json!({ "count": count })),
            })
        }
    }

    fn search_recursive(
        &self,
        path: &Path,
        pattern: &str,
        glob: Option<&str>,
        matches: &mut Vec<String>,
    ) -> Result<()> {
        if !path.is_dir() {
            return Ok(());
        }
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();
            if entry_path.is_dir() {
                self.search_recursive(&entry_path, pattern, glob, matches)?;
            } else if entry_path.is_file() {
                if let Some(glob_pattern) = glob {
                    let file_name = entry_path.file_name().unwrap_or_default().to_string_lossy();
                    if !simple_glob_match(glob_pattern, &file_name) {
                        continue;
                    }
                }
                if let Ok(content) = std::fs::read_to_string(&entry_path) {
                    for (i, line) in content.lines().enumerate() {
                        if line.contains(pattern) {
                            matches.push(format!(
                                "{}:{}: {}",
                                entry_path.display(),
                                i + 1,
                                line.trim()
                            ));
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

/// Simple glob matching supporting * and ? wildcards.
fn simple_glob_match(pattern: &str, text: &str) -> bool {
    glob_match_recursive(
        &pattern.chars().collect::<Vec<_>>(),
        &text.chars().collect::<Vec<_>>(),
        0,
        0,
    )
}

fn glob_match_recursive(pattern: &[char], text: &[char], pi: usize, ti: usize) -> bool {
    if pi == pattern.len() && ti == text.len() {
        return true;
    }
    if pi == pattern.len() {
        return false;
    }
    match pattern[pi] {
        '*' => {
            // Match zero or more characters
            for i in ti..=text.len() {
                if glob_match_recursive(pattern, text, pi + 1, i) {
                    return true;
                }
            }
            false
        }
        '?' => {
            if ti < text.len() {
                glob_match_recursive(pattern, text, pi + 1, ti + 1)
            } else {
                false
            }
        }
        c => {
            if ti < text.len() && text[ti] == c {
                glob_match_recursive(pattern, text, pi + 1, ti + 1)
            } else {
                false
            }
        }
    }
}
