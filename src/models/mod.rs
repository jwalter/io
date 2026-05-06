use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Represents a squad of agents for a specific project
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Squad {
    pub id: String,
    pub project_slug: String,
    pub project_path: Option<String>,
    pub agents: Vec<Agent>,
    pub created_at: DateTime<Utc>,
    pub last_active_at: DateTime<Utc>,
}

/// An agent within a squad
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub squad_id: String,
    pub name: String,
    pub role: String,
    pub specializations: Vec<String>,
    pub skills: Vec<String>,
    pub status: AgentStatus,
    pub hired_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentStatus {
    Active,
    Idle,
    Retired,
}

/// A tool that agents can use
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// Represents a message in a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
    pub source: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MessageRole {
    User,
    Assistant,
    System,
}
