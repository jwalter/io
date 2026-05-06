//! Shell command execution tool.

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::process::Command;

use super::{Tool, ToolResult};

pub struct ShellTool;

#[async_trait]
impl Tool for ShellTool {
    fn name(&self) -> &str {
        "shell"
    }

    fn description(&self) -> &str {
        "Execute shell commands and return stdout, stderr, and exit code"
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                },
                "working_dir": {
                    "type": "string",
                    "description": "Working directory for command execution"
                },
                "timeout_secs": {
                    "type": "integer",
                    "description": "Timeout in seconds (default: 30)",
                    "default": 30
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, args: Value) -> Result<ToolResult> {
        let command = args["command"].as_str().unwrap_or("");
        let working_dir = args["working_dir"].as_str();
        let timeout_secs = args["timeout_secs"].as_u64().unwrap_or(30);

        if command.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: "No command provided".to_string(),
                metadata: None,
            });
        }

        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.args(["/C", command]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", command]);
            c
        };

        if let Some(dir) = working_dir {
            cmd.current_dir(dir);
        }

        let result = tokio::time::timeout(Duration::from_secs(timeout_secs), cmd.output()).await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let exit_code = output.status.code().unwrap_or(-1);
                let success = output.status.success();

                let combined = if stderr.is_empty() {
                    stdout.clone()
                } else {
                    format!("{stdout}\n[stderr]\n{stderr}")
                };

                Ok(ToolResult {
                    success,
                    output: combined,
                    metadata: Some(json!({
                        "exit_code": exit_code,
                        "stdout": stdout,
                        "stderr": stderr,
                    })),
                })
            }
            Ok(Err(e)) => Ok(ToolResult {
                success: false,
                output: format!("Failed to execute command: {e}"),
                metadata: None,
            }),
            Err(_) => Ok(ToolResult {
                success: false,
                output: format!("Command timed out after {timeout_secs} seconds"),
                metadata: None,
            }),
        }
    }
}
