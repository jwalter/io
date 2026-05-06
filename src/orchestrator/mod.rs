//! Orchestrator: routes messages to squads, never generates directly.
//!
//! The orchestrator maintains a persistent Copilot session and uses tools
//! to recall/compose squads and delegate work to specialist agents.

use std::sync::Arc;

use anyhow::Result;

use crate::config::Config;
use crate::copilot::{CopilotManager, MessageOptions, Session, SessionOptions, ToolDefinition};
use crate::event_bus::{Event, EventBus, MessageSource};
use crate::squad::SquadManager;

/// The Orchestrator system prompt — defines its routing-only behavior
const ORCHESTRATOR_SYSTEM_PROMPT: &str = r#"You are the IO Daemon Orchestrator. You NEVER generate code, documents, or artifacts directly.

Your job is to:
1. Understand the user's intent
2. Recall or compose the appropriate squad for the task
3. Route work to squad members via tools
4. Synthesize results back to the user

You have access to these tools:
- squad_recall: Recall an existing squad for a project
- squad_create: Create a new squad for a project
- squad_hire: Hire a new specialist agent into a squad
- squad_route: Route a task to a specific agent in a squad
- squad_status: Get the current status of a squad and its agents
- squad_decide: Record a decision for the squad

Rules:
- ALWAYS delegate work to agents. Never do the work yourself.
- When routing work, provide clear context and task descriptions.
- If a task requires expertise not covered by current agents, hire a new specialist first.
- Synthesize agent results into clear summaries for the user.
"#;

/// The Orchestrator manages message flow and agent coordination.
pub struct Orchestrator {
    config: Arc<Config>,
    copilot: CopilotManager,
    squad_manager: Arc<SquadManager>,
    event_bus: Arc<EventBus>,
    session: Option<Session>,
    /// Currently active squad (loaded when user specifies a project context)
    active_squad_id: Option<String>,
}

impl Orchestrator {
    pub fn new(
        config: Arc<Config>,
        copilot: CopilotManager,
        squad_manager: Arc<SquadManager>,
        event_bus: Arc<EventBus>,
    ) -> Self {
        Self {
            config,
            copilot,
            squad_manager,
            event_bus,
            session: None,
            active_squad_id: None,
        }
    }

    /// Initialize the orchestrator's persistent Copilot session.
    pub async fn start(&mut self) -> Result<()> {
        let options = SessionOptions {
            system_prompt: ORCHESTRATOR_SYSTEM_PROMPT.to_string(),
            model: Some(self.config.models.default.clone()),
            tools: self.orchestrator_tools(),
        };

        let session = self.copilot.create_session(options).await?;
        self.session = Some(session);

        tracing::info!("Orchestrator started with persistent session");
        Ok(())
    }

    /// Handle an incoming user message from any interface.
    pub async fn handle_message(&mut self, content: &str, source: MessageSource) -> Result<String> {
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Orchestrator session not initialized"))?;

        // Publish the user message event
        self.event_bus.publish(Event::UserMessage {
            content: content.to_string(),
            source,
            timestamp: chrono::Utc::now(),
        });

        // Send to the orchestrator's Copilot session
        session.send_and_wait(MessageOptions::new(content)).await?;

        // In the real implementation, the response will come through the session handler
        // and tool calls will be intercepted and executed locally.
        // For now, return a placeholder.
        Ok(format!("Orchestrator received: {}", content))
    }

    /// Set the active project context (triggers squad recall).
    pub async fn set_project_context(&mut self, project_slug: &str) -> Result<()> {
        match self.squad_manager.recall_squad(project_slug)? {
            Some(squad) => {
                self.active_squad_id = Some(squad.id.clone());
                tracing::info!(
                    project = project_slug,
                    agents = squad.agents.len(),
                    "Recalled existing squad"
                );

                self.event_bus.publish(Event::SquadUpdated {
                    squad_id: squad.id,
                    action: "recalled".to_string(),
                });
            }
            None => {
                tracing::info!(
                    project = project_slug,
                    "No existing squad, will create on demand"
                );
            }
        }
        Ok(())
    }

    /// Get the tool definitions the orchestrator exposes to its Copilot session.
    fn orchestrator_tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition {
                name: "squad_recall".to_string(),
                description: "Recall an existing squad for a project by its slug".to_string(),
                parameters_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "project_slug": { "type": "string", "description": "The project identifier" }
                    },
                    "required": ["project_slug"]
                }),
            },
            ToolDefinition {
                name: "squad_create".to_string(),
                description: "Create a new squad for a project".to_string(),
                parameters_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "project_slug": { "type": "string", "description": "The project identifier" },
                        "project_path": { "type": "string", "description": "Filesystem path to the project" }
                    },
                    "required": ["project_slug", "project_path"]
                }),
            },
            ToolDefinition {
                name: "squad_hire".to_string(),
                description: "Hire a new specialist agent into the active squad".to_string(),
                parameters_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Agent name (kebab-case)" },
                        "role": { "type": "string", "description": "Agent role title" },
                        "specializations": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "List of specialization areas"
                        }
                    },
                    "required": ["name", "role", "specializations"]
                }),
            },
            ToolDefinition {
                name: "squad_route".to_string(),
                description: "Route a task to a specific agent in the active squad".to_string(),
                parameters_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "agent_name": { "type": "string", "description": "Target agent name" },
                        "task": { "type": "string", "description": "Task description" },
                        "context": { "type": "string", "description": "Additional context for the agent" }
                    },
                    "required": ["agent_name", "task"]
                }),
            },
            ToolDefinition {
                name: "squad_status".to_string(),
                description: "Get current status of the active squad and its agents".to_string(),
                parameters_schema: serde_json::json!({
                    "type": "object",
                    "properties": {}
                }),
            },
            ToolDefinition {
                name: "squad_decide".to_string(),
                description: "Record an important decision for the squad".to_string(),
                parameters_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "description": "Decision title" },
                        "content": { "type": "string", "description": "Decision details and rationale" }
                    },
                    "required": ["title", "content"]
                }),
            },
        ]
    }

    /// Gracefully shut down the orchestrator.
    pub async fn stop(&mut self) -> Result<()> {
        self.session = None;
        tracing::info!("Orchestrator stopped");
        Ok(())
    }
}
