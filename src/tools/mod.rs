//! Tool system: trait definition, registry, and built-in tools.

pub mod calendar;
pub mod file_ops;
pub mod shell;
pub mod web;
pub mod wiki;

use async_trait::async_trait;
use serde_json::{json, Value};
use anyhow::Result;

use calendar::CalendarTool;
use file_ops::FileOpsTool;
use shell::ShellTool;
use web::WebTool;
use wiki::WikiTool;

/// The core trait that all tools implement.
#[async_trait]
pub trait Tool: Send + Sync {
    /// Unique name of this tool
    fn name(&self) -> &str;

    /// Human-readable description
    fn description(&self) -> &str;

    /// JSON Schema for the tool's parameters
    fn parameters_schema(&self) -> Value;

    /// Execute the tool with the given arguments
    async fn execute(&self, args: Value) -> Result<ToolResult>;
}

/// Result of a tool execution
#[derive(Debug, Clone)]
pub struct ToolResult {
    pub success: bool,
    pub output: String,
    pub metadata: Option<Value>,
}

/// Registry of available tools
pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self { tools: Vec::new() }
    }

    /// Create a registry with all built-in tools registered.
    pub fn register_defaults() -> Self {
        let mut registry = Self::new();
        registry.register(Box::new(FileOpsTool));
        registry.register(Box::new(ShellTool));
        registry.register(Box::new(WebTool));
        registry.register(Box::new(WikiTool::new()));
        registry.register(Box::new(CalendarTool::new()));
        registry
    }

    pub fn register(&mut self, tool: Box<dyn Tool>) {
        self.tools.push(tool);
    }

    pub fn get(&self, name: &str) -> Option<&dyn Tool> {
        self.tools.iter().find(|t| t.name() == name).map(|t| t.as_ref())
    }

    pub fn list(&self) -> Vec<&dyn Tool> {
        self.tools.iter().map(|t| t.as_ref()).collect()
    }

    /// Return tool definitions suitable for Copilot SDK registration.
    pub fn to_definitions(&self) -> Vec<Value> {
        self.tools
            .iter()
            .map(|tool| {
                json!({
                    "name": tool.name(),
                    "description": tool.description(),
                    "parameters": tool.parameters_schema(),
                })
            })
            .collect()
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}
