//! Orchestrator: handles messages with a hybrid approach.
//!
//! Simple/conversational messages get direct responses. Complex or
//! project-specific tasks are delegated to specialist agent squads.

use std::sync::Arc;

use anyhow::Result;

use crate::config::Config;
use crate::copilot::{CopilotManager, Session, SessionOptions, ToolDefinition};
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
        // Ensure the Copilot client is started before creating a session
        self.copilot.start().await?;

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
    ///
    /// While the Copilot SDK facade is in place, the orchestrator uses a
    /// local heuristic to decide whether to respond directly or indicate
    /// that squad routing would be needed. Once the real SDK is wired up,
    /// the LLM itself will decide by either responding with text (direct)
    /// or calling squad tools (delegation).
    pub async fn handle_message(&mut self, content: &str, source: MessageSource) -> Result<String> {
        let _session = self
            .session
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Orchestrator session not initialized"))?;

        // Publish the user message event
        self.event_bus.publish(Event::UserMessage {
            content: content.to_string(),
            source,
            timestamp: chrono::Utc::now(),
        });

        // TODO: When real Copilot SDK is available, replace this with:
        //   session.send_and_wait(MessageOptions::new(content)).await?;
        //   // Response comes through the session handler — text for direct,
        //   // tool calls for delegation.

        // Facade mode: use local heuristic
        if Self::is_conversational(content) {
            Ok(Self::generate_direct_response(content))
        } else {
            // In facade mode, we can't actually delegate to squads yet.
            // Acknowledge the request and explain.
            Ok(format!(
                "I'd route this to a specialist squad, but the Copilot SDK integration \
                 isn't fully wired up yet. Your request: \"{}\"",
                content
            ))
        }
    }

    /// Heuristic to determine if a message is conversational (direct response)
    /// vs. project work (squad delegation).
    ///
    /// This is a temporary bridge until the real Copilot SDK is integrated,
    /// at which point the LLM decides routing by choosing to call tools or not.
    fn is_conversational(content: &str) -> bool {
        let lower = content.to_lowercase();
        let len = lower.len();

        // Short messages are almost always conversational
        if len < 20 {
            return true;
        }

        // Greeting patterns
        let greetings = [
            "hello", "hi", "hey", "good morning", "good afternoon", "good evening",
            "howdy", "sup", "what's up", "how are you", "thanks", "thank you",
            "bye", "goodbye", "see you",
        ];
        if greetings.iter().any(|g| lower.contains(g)) {
            return true;
        }

        // General knowledge / explanation patterns
        let knowledge_patterns = [
            "what is ", "what are ", "what does ",
            "explain ", "define ", "describe ",
            "how does ", "why does ", "why is ",
            "tell me about ", "who is ", "who was ",
            "can you explain",
        ];
        if knowledge_patterns.iter().any(|p| lower.starts_with(p) || lower.contains(p)) {
            return true;
        }

        // Status / meta questions
        let meta = [
            "what can you do", "help", "what squads",
            "who are you", "your name", "your version",
        ];
        if meta.iter().any(|m| lower.contains(m)) {
            return true;
        }

        // Project-work indicators → not conversational
        let project_indicators = [
            "create a ", "build ", "implement ", "refactor ",
            "fix ", "debug ", "deploy ", "write code",
            "generate ", "modify ", "update the ",
            "in the project", "in the repo", "in the codebase",
            "pull request", "commit", "merge",
        ];
        if project_indicators.iter().any(|p| lower.contains(p)) {
            return false;
        }

        // Default: treat as conversational for shorter messages,
        // delegate longer ones that might be complex requests
        len < 100
    }

    /// Generate a simple direct response in facade mode.
    ///
    /// Once the real Copilot SDK is integrated, this function goes away —
    /// the LLM generates the response through the session.
    fn generate_direct_response(content: &str) -> String {
        let lower = content.to_lowercase();

        if lower.contains("hello") || lower.contains("hi") || lower.contains("hey") {
            return "Hey there! 👋 I'm IO, your personal AI assistant. How can I help you today?".to_string();
        }

        if lower.contains("how are you") {
            return "I'm running smoothly! All systems operational. What can I help you with?".to_string();
        }

        if lower.contains("thank") {
            return "You're welcome! Let me know if there's anything else I can help with.".to_string();
        }

        if lower.contains("what can you do") || lower.contains("help") {
            return "I can help with:\n\
                    • **Chat** — answer questions, explain concepts\n\
                    • **Squad management** — assemble specialist agent teams for your projects\n\
                    • **Knowledge** — search and maintain a personal wiki\n\
                    • **Tools** — file ops, shell commands, web fetch\n\n\
                    For project-specific work, I'll assemble a squad of specialist agents. \
                    For general questions, I'll answer directly!"
                .to_string();
        }

        if lower.contains("who are you") || lower.contains("your name") {
            return "I'm IO, a personal AI assistant daemon powered by the GitHub Copilot SDK. \
                    I coordinate specialist agent squads for your projects and can answer \
                    general questions directly."
                .to_string();
        }

        // Generic conversational fallback
        format!(
            "I hear you! While the full Copilot SDK integration is being finalized, \
             my direct response capabilities are limited. Your message: \"{}\"",
            content
        )
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
