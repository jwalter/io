//! Orchestrator: handles messages with a hybrid approach.
//!
//! Simple/conversational messages get direct responses from the model.
//! Complex or project-specific tasks are delegated to specialist agent
//! squads via tool calling.

use std::sync::Arc;

use anyhow::Result;

use crate::config::Config;
use crate::copilot::{ChatMessage, ChatResponse, GithubModelsClient, ToolCall, ToolDefinition};
use crate::db::Database;
use crate::event_bus::{EventBus, MessageSource};
use crate::skills::SkillCatalog;
use crate::squad::SquadManager;
use crate::tools::ToolRegistry;

/// The Orchestrator system prompt — defines hybrid direct-response + routing behavior
const ORCHESTRATOR_SYSTEM_PROMPT: &str = r#"You are IO, a personal AI assistant daemon. You are helpful, concise, and friendly.

## When to respond directly
Answer these yourself — no tools needed:
- Greetings and casual conversation ("hello", "how are you", "thanks")
- General knowledge questions ("what is a mutex?", "explain TCP vs UDP")
- Simple factual answers, math, definitions, explanations
- Status questions about yourself ("what can you do?", "what squads exist?")
- Opinions, recommendations, or advice that don't require project context

## When to use utility tools
Use these tools for practical tasks the user asks for:
- file_ops: Read, write, list, or search files on the local filesystem
- shell: Execute shell commands on the host system
- web: Fetch web pages or make HTTP requests
- wiki: Search and read Wikipedia articles
- calendar: Query and manage calendar events
- activate_skill: Load a skill's full instructions when a task matches an available skill
- skill_search: Search the skills.sh registry for community skills
- skill_install: Install a skill from skills.sh

## When to delegate to squads
Use squad tools when the request involves:
- Project-specific work that needs persistent project context
- Multi-step workflows that benefit from agent collaboration
- Tasks requiring specialist expertise across a project

## Squad management tools
- squad_recall: Recall an existing squad for a project
- squad_create: Create a new squad for a project
- squad_hire: Hire a new specialist agent into a squad
- squad_route: Route a task to a specific agent in a squad
- squad_status: Get the current status of a squad and its agents
- squad_decide: Record a decision for the squad

## Guidelines
- Be conversational and natural for simple interactions
- Use utility tools directly for straightforward tasks (reading a file, running a command)
- Delegate to squads for complex multi-step project work
- Synthesize results into clear summaries for the user
"#;

/// Maximum tool call rounds to prevent infinite loops.
const MAX_TOOL_ROUNDS: usize = 10;

/// The shared session ID — all interfaces share one conversation.
const SESSION_ID: &str = "default";

/// The Orchestrator manages message flow and agent coordination.
pub struct Orchestrator {
    config: Arc<Config>,
    client: Option<GithubModelsClient>,
    squad_manager: Arc<SquadManager>,
    tool_registry: ToolRegistry,
    skill_catalog: SkillCatalog,
    event_bus: Arc<EventBus>,
    db: Database,
    /// Conversation history (shared across all interfaces)
    messages: Vec<ChatMessage>,
    /// Whether history has been loaded from DB
    history_loaded: bool,
    /// Cached system prompt (regenerated each startup)
    system_prompt: String,
}

impl Orchestrator {
    pub fn new(
        config: Arc<Config>,
        squad_manager: Arc<SquadManager>,
        tool_registry: ToolRegistry,
        skill_catalog: SkillCatalog,
        event_bus: Arc<EventBus>,
        db: Database,
    ) -> Self {
        Self {
            config,
            client: None,
            squad_manager,
            tool_registry,
            skill_catalog,
            event_bus,
            db,
            messages: Vec::new(),
            history_loaded: false,
            system_prompt: String::new(),
        }
    }

    /// Initialize the orchestrator — connects to GitHub Models API.
    pub async fn start(&mut self) -> Result<()> {
        let client = GithubModelsClient::new().await?;
        self.client = Some(client);

        // Build system prompt with skill catalog appended
        let mut system_prompt = ORCHESTRATOR_SYSTEM_PROMPT.to_string();
        let skills_xml = self.skill_catalog.to_prompt_xml();
        if !skills_xml.is_empty() {
            system_prompt.push_str(&skills_xml);
            tracing::info!(
                skills = self.skill_catalog.len(),
                "Loaded skill catalog into system prompt"
            );
        }
        self.system_prompt = system_prompt;

        tracing::info!(
            model = %self.config.models.default,
            "Orchestrator started with GitHub Models API"
        );
        Ok(())
    }

    /// Ensure conversation history is loaded from DB.
    fn ensure_history_loaded(&mut self) {
        if self.history_loaded {
            return;
        }
        self.history_loaded = true;

        // Always start with the system prompt
        self.messages.push(ChatMessage::system(&self.system_prompt));

        // Load persisted messages from DB
        let max = self.config.history.max_messages;
        match self.db.load_session_messages(SESSION_ID, max) {
            Ok(stored) if !stored.is_empty() => {
                tracing::info!(count = stored.len(), "Restored conversation history");
                for msg in stored {
                    // Reconstruct ChatMessage from stored data
                    if msg.role == "assistant" && msg.tool_calls_json.is_some() {
                        // Assistant message with tool calls
                        if let Some(tc_json) = &msg.tool_calls_json {
                            if let Ok(tool_calls) = serde_json::from_str::<Vec<ToolCall>>(tc_json) {
                                self.messages
                                    .push(ChatMessage::assistant_with_tool_calls(tool_calls));
                                continue;
                            }
                        }
                    }

                    if msg.role == "tool" {
                        if let (Some(tc_id), Some(content)) = (&msg.tool_call_id, &msg.content) {
                            self.messages.push(ChatMessage::tool_result(tc_id, content));
                            continue;
                        }
                    }

                    // Standard user/assistant/system message
                    let content = msg.content.unwrap_or_default();
                    match msg.role.as_str() {
                        "user" => self.messages.push(ChatMessage::user(&content)),
                        "assistant" => self.messages.push(ChatMessage::assistant(&content)),
                        _ => {} // skip unknown roles
                    }
                }
            }
            Ok(_) => {
                tracing::debug!("No conversation history found, starting fresh");
            }
            Err(e) => {
                tracing::warn!("Failed to load conversation history: {e:#}");
            }
        }
    }

    /// Persist a message to the database.
    fn persist_message(
        &self,
        role: &str,
        content: Option<&str>,
        tool_call_id: Option<&str>,
        tool_calls: Option<&[ToolCall]>,
    ) {
        let tc_json = tool_calls.and_then(|tcs| serde_json::to_string(tcs).ok());
        if let Err(e) =
            self.db
                .save_message(SESSION_ID, role, content, tool_call_id, tc_json.as_deref())
        {
            tracing::warn!("Failed to persist message: {e:#}");
        }
        if let Err(e) = self.db.touch_session(SESSION_ID) {
            tracing::warn!("Failed to touch session: {e:#}");
        }
    }

    /// Handle an incoming user message from any interface.
    pub async fn handle_message(
        &mut self,
        content: &str,
        _source: MessageSource,
    ) -> Result<String> {
        // Load history from DB on first message (before borrowing client)
        self.ensure_history_loaded();

        if self.client.is_none() {
            anyhow::bail!("Orchestrator not started");
        }

        // Append user message to history and persist
        self.messages.push(ChatMessage::user(content));
        self.persist_message("user", Some(content), None, None);

        let model = self.config.models.default.clone();
        let tools = self.orchestrator_tools();

        tracing::debug!(model = %model, "Processing user message");

        // Tool call loop — model may respond with text or request tool calls
        let mut rounds = 0;
        loop {
            rounds += 1;
            if rounds > MAX_TOOL_ROUNDS {
                tracing::warn!(model = %model, "Tool call loop exceeded max rounds, returning partial response");
                break;
            }

            let response = self
                .client
                .as_ref()
                .unwrap()
                .chat_completion(&self.messages, &tools, &model)
                .await?;

            match response {
                ChatResponse::Message(text) => {
                    // Model responded directly — store, persist, and return
                    self.messages.push(ChatMessage::assistant(&text));
                    self.persist_message("assistant", Some(&text), None, None);
                    return Ok(text);
                }
                ChatResponse::ToolCalls(tool_calls) => {
                    // Model wants to call tools — execute them and continue
                    self.messages
                        .push(ChatMessage::assistant_with_tool_calls(tool_calls.clone()));
                    self.persist_message("assistant", None, None, Some(&tool_calls));

                    for tc in &tool_calls {
                        let result = self.execute_tool_call(tc).await;
                        self.messages
                            .push(ChatMessage::tool_result(&tc.id, &result));
                        self.persist_message("tool", Some(&result), Some(&tc.id), None);
                    }
                    // Loop back to let model process tool results
                }
            }
        }

        // Fallback if we hit max rounds
        let fallback = "I'm having trouble completing that request. Please try again.";
        self.persist_message("assistant", Some(fallback), None, None);
        Ok(fallback.to_string())
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

        // Check the tool registry first (file_ops, shell, web, wiki, calendar, etc.)
        if let Some(tool) = self.tool_registry.get(&tool_call.function.name) {
            return match tool.execute(args).await {
                Ok(result) => result.output,
                Err(e) => format!("Tool error: {e}"),
            };
        }

        // Fall back to built-in squad management tools
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
        // Start with tools from the registry
        let mut tools: Vec<ToolDefinition> = self
            .tool_registry
            .list()
            .iter()
            .map(|t| ToolDefinition::new(t.name(), t.description(), t.parameters_schema()))
            .collect();

        // Add squad management tools
        tools.extend(vec![
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
        ]);

        tools
    }

    /// Gracefully shut down the orchestrator.
    pub async fn stop(&mut self) -> Result<()> {
        self.client = None;
        tracing::info!("Orchestrator stopped");
        Ok(())
    }
}
