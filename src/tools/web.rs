//! Web fetch tool using reqwest.

use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};

use super::{Tool, ToolResult};

pub struct WebTool;

#[async_trait]
impl Tool for WebTool {
    fn name(&self) -> &str {
        "web_fetch"
    }

    fn description(&self) -> &str {
        "Fetch content from a URL and return the response body as text"
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["fetch"],
                    "description": "The web operation to perform"
                },
                "url": {
                    "type": "string",
                    "description": "The URL to fetch"
                },
                "max_length": {
                    "type": "integer",
                    "description": "Maximum number of characters to return (default: 10000)",
                    "default": 10000
                }
            },
            "required": ["url"]
        })
    }

    async fn execute(&self, args: Value) -> Result<ToolResult> {
        let url = args["url"].as_str().unwrap_or("");
        let max_length = args["max_length"].as_u64().unwrap_or(10000) as usize;

        if url.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: "No URL provided".to_string(),
                metadata: None,
            });
        }

        match reqwest::get(url).await {
            Ok(response) => {
                let status = response.status().as_u16();
                match response.text().await {
                    Ok(body) => {
                        let truncated = body.len() > max_length;
                        let output = if truncated {
                            body[..max_length].to_string()
                        } else {
                            body
                        };

                        Ok(ToolResult {
                            success: status < 400,
                            output,
                            metadata: Some(json!({
                                "status": status,
                                "truncated": truncated,
                            })),
                        })
                    }
                    Err(e) => Ok(ToolResult {
                        success: false,
                        output: format!("Failed to read response body: {e}"),
                        metadata: Some(json!({ "status": status })),
                    }),
                }
            }
            Err(e) => Ok(ToolResult {
                success: false,
                output: format!("Request failed: {e}"),
                metadata: None,
            }),
        }
    }
}
