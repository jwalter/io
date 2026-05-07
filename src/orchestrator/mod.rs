//! Orchestrator: handles messages with a hybrid approach.
//!
//! Simple/conversational messages get direct responses from the model.
//! Complex or project-specific tasks are delegated to specialist agent
//! squads via tool calling.

use std::sync::Arc;

use anyhow::Result;

use crate::config::Config;
use crate::copilot::{ChatMessage, ChatResponse, GithubModelsClient, ToolCall, ToolDefinition};
use crate::event_bus::{Event, EventBus, MessageSource};
use crate::squad::SquadManager;

/// The Orchestrator system prompt — defines hybrid direct-response + routing behavior
const ORCHESTRATOR_SYSTEM_PROMPT: &str = r#"You are IO, a personal AI assistant daemon. You are helpful, concise, and friendly.

## When to respond directly
Answer these yourself — no tools needed:
- Greetings and casual conversation ("hello", "how are you", "thanks")
- General knowledge questions ("what is a mutex?", "explain TCP vs UDP")
- Simple factual answers, math, definitions, explanations
- Status questions about yourself ("what can you do?", "what squads exist?")
- Opinions, recommendations, or advice that don't require project context

## When to delegate to squads
Use your squad tools when the request involves:
- Project-specific work (code generation, refactoring, debugging)
- File operations (reading, writing, searching project files)
- Tasks requiring specialist expertise (security review, architecture design)
- Multi-step workflows that benefit from agent collaboration
- Anything that needs persistent project context or history

## Available tools
- squad_recall: Recall an existing squad for a project
- squad_create: Create a new squad for a project
- squad_hire: Hire a new specialist agent into a squad
- squad_route: Route a task to a specific agent in a squad
- squad_status: Get the current status of a squad and its agents
- squad_decide: Record a decision for the squad

## Guidelines
- Be conversational and natural for simple interactions
- When delegating, provide clear context and task descriptions to agents
- If a task requires expertise not covered by current agents, hire a new specialist first
- Synthesize agent results into clear summaries for the user
"#;

/// Maximum tool call rounds to prevent infinite loops.
const MAX_TOOL_ROUNDS: usize = 10;

/// The Orchestrator manages message flow and agent coordination.
pub struct Orchestrator {
    config: Arc<Config>,
    client: Option<GithubModelsClient>,
    squad_manager: Arc<SquadManager>,
    event_bus: Arc<EventBus>,
    /// Conversation history (per-session, simplified for now)
    messages: Vec<ChatMessage>,
}

impl Orchestrator {
    pub fn new(
        config: Arc<Config>,
        squad_manager: Arc<SquadManager>,
        event_bus: Arc<EventBus>,
    ) -> Self {
        Self {
            config,
            client: None,
            squad_manager,
            event_bus,
            messages: Vec::new(),
        }
    }

    /// Initialize the orchestrator — connects to GitHub Models API.
    pub async fn start(&mut self) -> Result<()> {
        let client = GithubModelsClient::new().await?;
        self.client = Some(client);

        // Seed conversation with system prompt
        self.messages
            .push(ChatMessage::system(ORCHESTRATOR_SYSTEM_PROMPT));

        tracing::info!("Orchestrator started with GitHub Models API");
        Ok(())
    }

    /// Handle an incoming user message from any interface.
    pub async fn handle_message(&mut self, content: &str, source: MessageSource) -> Result<String> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Orchestrator not started"))?;

        // Publish the user message event
        self.event_bus.publish(Event::UserMessage {
            content: content.to_string(),
            source,
            timestamp: chrono::Utc::now(),
        });

        // Append user message to history
        self.messages.push(ChatMessage::user(content));

        let model = &self.config.models.default;
        let tools = self.orchestrator_tools();

        // Tool call loop — model may respond with text or request tool calls
        let mut rounds = 0;
        loop {
            rounds += 1;
            if rounds > MAX_TOOL_ROUNDS {
                tracing::warn!("Tool call loop exceeded max rounds, returning partial response");
                break;
            }

            let response = client
                .chat_completion(&self.messages, &tools, model)
                .await?;

            match response {
                ChatResponse::Message(text) => {
                    // Model responded directly — store and return
                    self.messages.push(ChatMessage::assistant(&text));
                    return Ok(text);
                }
                ChatResponse::ToolCalls(tool_calls) => {
                    // Model wants to call tools — execute them and continue
                    self.messages
                        .push(ChatMessage::assistant_with_tool_calls(tool_calls.clone()));

                    for tc in &tool_calls {
                        let result = self.execute_tool_call(tc).await;
                        self.messages
                            .push(ChatMessage::tool_result(&tc.id, &result));
                    }
                    // Loop back to let model process tool results
                }
            }
        }

        // Fallback if we hit max rounds
        Ok("I'm having trouble completing that request. Please try again.".to_string())
    }

    /// Execute a tool call and return the result as a string.
    async fn execute_tool_call(&self, tool_call: &ToolCall) -> String {
        let args: serde_json::Value =
            serde_json::from_str(&tool_call.function.arguments).unwrap_or(serde_json::json!({}));

        tracing::info!(
            tool = %tool_call.function.name,
            args = %args,
            "Executing tool call"
        );

        match tool_call.function.name.as_str() {
            "squad_recall" => {
                let slug = args["project_slug"].as_str().unwrap_or("");
                match self.squad_manager.recall_squad(slug) {
                    Ok(Some(squad)) => {
                        let agents: Vec<&str> =
                            squad.agents.iter().map(|a| a.name.as_str()).collect();
                        format!(
                            "Squad '{}' recalled with {} agents: {}",
                            slug,
                            agents.len(),
                            agents.join(", ")
                        )
                    }
                    Ok(None) => format!("No squad found for project '{slug}'"),
                    Err(e) => format!("Error recalling squad: {e}"),
                }
            }
            "squad_create" => {
                let slug = args["project_slug"].as_str().unwrap_or("");
                let path = args["project_path"].as_str().unwrap_or("");
                match self.squad_manager.create_squad(slug, path) {
                    Ok(squad) => format!("Created squad '{}' for project at {}", squad.id, path),
                    Err(e) => format!("Error creating squad: {e}"),
                }
            }
            "squad_hire" => {
                let name = args["name"].as_str().unwrap_or("agent");
                let role = args["role"].as_str().unwrap_or("generalist");
                let specializations: Vec<String> = args["specializations"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                format!(
                    "Hired agent '{}' as {} with specializations: {}",
                    name,
                    role,
                    specializations.join(", ")
                )
            }
            "squad_route" => {
                let agent_name = args["agent_name"].as_str().unwrap_or("");
                let task = args["task"].as_str().unwrap_or("");
                format!("Routed task to agent '{}': {}", agent_name, task)
            }
            "squad_status" => "Squad status: operational (detailed status coming soon)".to_string(),
            "squad_decide" => {
                let title = args["title"].as_str().unwrap_or("");
                let content = args["content"].as_str().unwrap_or("");
                format!("Decision recorded: {} — {}", title, content)
            }
            _ => format!("Unknown tool: {}", tool_call.function.name),
        }
    }

    /// Get the tool definitions in OpenAI format.
    fn orchestrator_tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "squad_recall",
                "Recall an existing squad for a project by its slug",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "project_slug": { "type": "string", "description": "The project identifier" }
                    },
                    "required": ["project_slug"]
                }),
            ),
            ToolDefinition::new(
                "squad_create",
                "Create a new squad for a project",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "project_slug": { "type": "string", "description": "The project identifier" },
                        "project_path": { "type": "string", "description": "Filesystem path to the project" }
                    },
                    "required": ["project_slug", "project_path"]
                }),
            ),
            ToolDefinition::new(
                "squad_hire",
                "Hire a new specialist agent into the active squad",
                serde_json::json!({
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
            ),
            ToolDefinition::new(
                "squad_route",
                "Route a task to a specific agent in the active squad",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "agent_name": { "type": "string", "description": "Target agent name" },
                        "task": { "type": "string", "description": "Task description" },
                        "context": { "type": "string", "description": "Additional context for the agent" }
                    },
                    "required": ["agent_name", "task"]
                }),
            ),
            ToolDefinition::new(
                "squad_status",
                "Get current status of the active squad and its agents",
                serde_json::json!({
                    "type": "object",
                    "properties": {}
                }),
            ),
            ToolDefinition::new(
                "squad_decide",
                "Record an important decision for the squad",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "description": "Decision title" },
                        "content": { "type": "string", "description": "Decision details and rationale" }
                    },
                    "required": ["title", "content"]
                }),
            ),
        ]
    }

    /// Gracefully shut down the orchestrator.
    pub async fn stop(&mut self) -> Result<()> {
        self.client = None;
        tracing::info!("Orchestrator stopped");
        Ok(())
    }
}
