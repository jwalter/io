//! Copilot SDK integration module.
//!
//! Provides a wrapper around the GitHub Copilot SDK for LLM interaction.
//! Currently uses a local facade since the SDK crate (github-copilot-sdk v0.1.0)
//! may not be resolvable yet. The facade mirrors the SDK's API so the rest of
//! the system can be built against a stable interface.

// TODO: Replace facade with real SDK when available:
// use github_copilot_sdk::{Client, ClientOptions};
// use github_copilot_sdk::handler::{HandlerEvent, HandlerResponse, SessionHandler};

use std::sync::Arc;
use tokio::sync::broadcast;
use tracing;

use crate::event_bus::Event;

// ─── Facade types (mirroring github-copilot-sdk API) ────────────────────────

/// Tool definition schema for registering tools with a session.
#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters_schema: serde_json::Value,
}

/// Options for creating the underlying SDK client.
// TODO: Replace with real SDK when available
#[derive(Debug, Clone, Default)]
pub struct ClientOptions {
    /// Optional transport override (default: stdio)
    pub transport: Option<String>,
}

/// Represents a connected Copilot CLI client.
// TODO: Replace with real SDK when available
pub struct CopilotClient {
    _options: ClientOptions,
}

impl CopilotClient {
    /// Start the Copilot CLI client process.
    pub async fn start(options: ClientOptions) -> anyhow::Result<Self> {
        tracing::info!("Starting Copilot CLI client (facade mode)");
        Ok(Self { _options: options })
    }

    /// Create a new session with the given configuration.
    pub async fn create_session(&self, config: SessionConfig) -> anyhow::Result<Session> {
        tracing::info!(model = ?config.model, "Creating Copilot session (facade mode)");
        Ok(Session {
            id: uuid::Uuid::new_v4().to_string(),
            _config: config,
        })
    }

    /// Gracefully shut down the client.
    pub async fn stop(&self) -> anyhow::Result<()> {
        tracing::info!("Stopping Copilot CLI client (facade mode)");
        Ok(())
    }
}

/// Configuration for a Copilot session.
// TODO: Replace with real SDK when available
#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub handler: Option<Arc<dyn SessionHandler>>,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            system_prompt: None,
            model: None,
            handler: None,
        }
    }
}

impl SessionConfig {
    pub fn with_handler(mut self, handler: Arc<dyn SessionHandler>) -> Self {
        self.handler = Some(handler);
        self
    }

    pub fn with_system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.system_prompt = Some(prompt.into());
        self
    }

    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }
}

/// A Copilot session that can send/receive messages.
// TODO: Replace with real SDK when available
#[derive(Debug)]
pub struct Session {
    pub id: String,
    _config: SessionConfig,
}

impl Session {
    /// Send a message and wait for the response to complete.
    pub async fn send_and_wait(&self, options: MessageOptions) -> anyhow::Result<()> {
        tracing::debug!(session_id = %self.id, content = %options.content, "send_and_wait (facade mode - no-op)");
        Ok(())
    }
}

/// Options for sending a message to a session.
#[derive(Debug, Clone)]
pub struct MessageOptions {
    pub content: String,
}

impl MessageOptions {
    pub fn new(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
        }
    }
}

/// Handler trait for session events (mirrors SDK's SessionHandler).
// TODO: Replace with real SDK when available
#[async_trait::async_trait]
pub trait SessionHandler: Send + Sync + std::fmt::Debug {
    async fn on_event(&self, event: HandlerEvent) -> HandlerResponse;
}

/// Events received from the Copilot SDK during a session.
// TODO: Replace with real SDK when available
#[derive(Debug, Clone)]
pub enum HandlerEvent {
    SessionEvent {
        event_type: String,
        data: serde_json::Value,
    },
    PermissionRequest {
        tool_name: String,
        arguments: serde_json::Value,
    },
    ToolCall {
        tool_name: String,
        arguments: serde_json::Value,
    },
}

/// Response from the handler back to the SDK.
// TODO: Replace with real SDK when available
#[derive(Debug, Clone)]
pub enum HandlerResponse {
    Ok,
    Permission(PermissionResult),
}

/// Result of a permission request.
// TODO: Replace with real SDK when available
#[derive(Debug, Clone)]
pub enum PermissionResult {
    Approved,
    Denied { reason: String },
}

// ─── Our wrapper types ──────────────────────────────────────────────────────

/// Configuration for the CopilotManager.
#[derive(Debug, Clone)]
pub struct CopilotConfig {
    /// Transport type (e.g., "stdio", "tcp://host:port")
    pub transport: Option<String>,
    /// Default model to use for sessions
    pub default_model: Option<String>,
}

impl Default for CopilotConfig {
    fn default() -> Self {
        Self {
            transport: None,
            default_model: None,
        }
    }
}

/// Options for creating a new session through CopilotManager.
#[derive(Debug, Clone)]
pub struct SessionOptions {
    /// System prompt to set session context
    pub system_prompt: String,
    /// Model override (falls back to CopilotConfig default)
    pub model: Option<String>,
    /// Tool schemas to register with the session
    pub tools: Vec<ToolDefinition>,
}

/// Manages the Copilot SDK client lifecycle.
pub struct CopilotManager {
    config: CopilotConfig,
    client: Option<CopilotClient>,
    event_sender: broadcast::Sender<Event>,
}

impl CopilotManager {
    /// Create a new CopilotManager with the given config and event bus sender.
    pub fn new(config: CopilotConfig, event_sender: broadcast::Sender<Event>) -> Self {
        Self {
            config,
            client: None,
            event_sender,
        }
    }

    /// Start the Copilot CLI client.
    pub async fn start(&mut self) -> anyhow::Result<()> {
        let options = ClientOptions {
            transport: self.config.transport.clone(),
        };
        let client = CopilotClient::start(options).await?;
        self.client = Some(client);
        tracing::info!("CopilotManager started");
        Ok(())
    }

    /// Create a new session with the given options.
    pub async fn create_session(&self, options: SessionOptions) -> anyhow::Result<Session> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Copilot client not started"))?;

        let handler = Arc::new(DaemonSessionHandler {
            event_sender: self.event_sender.clone(),
            session_name: "default".to_string(),
        });

        let mut config = SessionConfig::default()
            .with_handler(handler)
            .with_system_prompt(options.system_prompt);

        if let Some(model) = options.model.or_else(|| self.config.default_model.clone()) {
            config = config.with_model(model);
        }

        let session = client.create_session(config).await?;
        tracing::info!(session_id = %session.id, "Session created");
        Ok(session)
    }

    /// Gracefully shut down the Copilot client.
    pub async fn stop(&mut self) -> anyhow::Result<()> {
        if let Some(client) = self.client.take() {
            client.stop().await?;
        }
        tracing::info!("CopilotManager stopped");
        Ok(())
    }
}

// ─── Daemon session handler ─────────────────────────────────────────────────

/// Session handler that integrates with the io-daemon event bus.
///
/// - Forwards streaming token deltas as `Event::AgentDelta`
/// - Auto-approves all permission requests (trusted daemon context)
/// - Logs tool call events
#[derive(Debug)]
struct DaemonSessionHandler {
    event_sender: broadcast::Sender<Event>,
    session_name: String,
}

#[async_trait::async_trait]
impl SessionHandler for DaemonSessionHandler {
    async fn on_event(&self, event: HandlerEvent) -> HandlerResponse {
        match event {
            HandlerEvent::SessionEvent { event_type, data } => {
                if event_type == "assistant.message_delta" {
                    let content = data
                        .get("deltaContent")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    if !content.is_empty() {
                        let _ = self.event_sender.send(Event::AgentDelta {
                            agent_name: self.session_name.clone(),
                            content,
                            session_id: "active".to_string(),
                        });
                    }
                }
                HandlerResponse::Ok
            }
            HandlerEvent::PermissionRequest { tool_name, .. } => {
                tracing::debug!(tool = %tool_name, "Auto-approving permission request");
                HandlerResponse::Permission(PermissionResult::Approved)
            }
            HandlerEvent::ToolCall {
                tool_name,
                arguments,
            } => {
                tracing::info!(tool = %tool_name, args = %arguments, "Tool call received");
                HandlerResponse::Ok
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_copilot_manager_lifecycle() {
        let (sender, _) = broadcast::channel(16);
        let mut manager = CopilotManager::new(CopilotConfig::default(), sender);

        manager.start().await.unwrap();

        let session = manager
            .create_session(SessionOptions {
                system_prompt: "You are a helpful assistant.".to_string(),
                model: None,
                tools: vec![],
            })
            .await
            .unwrap();

        assert!(!session.id.is_empty());

        session
            .send_and_wait(MessageOptions::new("Hello"))
            .await
            .unwrap();

        manager.stop().await.unwrap();
    }

    #[tokio::test]
    async fn test_daemon_handler_publishes_delta() {
        let (sender, mut receiver) = broadcast::channel(16);
        let handler = DaemonSessionHandler {
            event_sender: sender,
            session_name: "test-agent".to_string(),
        };

        let event = HandlerEvent::SessionEvent {
            event_type: "assistant.message_delta".to_string(),
            data: serde_json::json!({ "deltaContent": "Hello" }),
        };

        let response = handler.on_event(event).await;
        assert!(matches!(response, HandlerResponse::Ok));

        let published = receiver.try_recv().unwrap();
        match published {
            Event::AgentDelta {
                agent_name,
                content,
                ..
            } => {
                assert_eq!(agent_name, "test-agent");
                assert_eq!(content, "Hello");
            }
            _ => panic!("Expected AgentDelta event"),
        }
    }

    #[tokio::test]
    async fn test_daemon_handler_auto_approves_permissions() {
        let (sender, _) = broadcast::channel(16);
        let handler = DaemonSessionHandler {
            event_sender: sender,
            session_name: "test".to_string(),
        };

        let event = HandlerEvent::PermissionRequest {
            tool_name: "file_read".to_string(),
            arguments: serde_json::json!({}),
        };

        let response = handler.on_event(event).await;
        assert!(matches!(
            response,
            HandlerResponse::Permission(PermissionResult::Approved)
        ));
    }
}
