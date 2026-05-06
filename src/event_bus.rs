use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// Events that flow through the system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Event {
    /// User sent a message (from any interface)
    UserMessage {
        content: String,
        source: MessageSource,
        timestamp: chrono::DateTime<chrono::Utc>,
    },
    /// Agent produced a response chunk (streaming)
    AgentDelta {
        agent_name: String,
        content: String,
        session_id: String,
    },
    /// Agent completed a response
    AgentComplete {
        agent_name: String,
        session_id: String,
    },
    /// Squad composition changed
    SquadUpdated { squad_id: String, action: String },
    /// System event (errors, status changes)
    System { level: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MessageSource {
    Tui,
    Telegram { chat_id: i64 },
    Web,
}

pub struct EventBus {
    sender: broadcast::Sender<Event>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(256);
        Self { sender }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.sender.subscribe()
    }

    pub fn publish(&self, event: Event) -> usize {
        self.sender.send(event).unwrap_or(0)
    }

    pub fn sender(&self) -> broadcast::Sender<Event> {
        self.sender.clone()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}
