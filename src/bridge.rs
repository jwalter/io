//! Orchestrator event bridge: routes UserMessage events to the Orchestrator
//! and publishes responses back as AgentDelta + AgentComplete events.

use std::sync::Arc;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{error, warn};

use crate::event_bus::{Event, EventBus, MessageSource};
use crate::orchestrator::Orchestrator;

/// A request forwarded from the event bus to the orchestrator task.
struct BridgeRequest {
    content: String,
    source: MessageSource,
}

/// Wrapper that allows moving the non-Send Orchestrator to a dedicated thread.
///
/// # Safety
/// The wrapped Orchestrator is only ever accessed from the single OS thread
/// that owns it — it is moved into the thread closure and never shared.
struct SendOrchestrator(Orchestrator);

// SAFETY: Orchestrator is not Send because it transitively contains
// rusqlite::Connection (which uses RefCell internally). We guarantee safety
// by moving it to exactly one dedicated thread and never sharing it.
unsafe impl Send for SendOrchestrator {}

/// Derive a deterministic session ID from the message source.
fn session_id_for(source: &MessageSource) -> String {
    match source {
        MessageSource::Tui => "tui-session".to_string(),
        MessageSource::Telegram { chat_id } => format!("telegram-{chat_id}"),
        MessageSource::Web => "web-session".to_string(),
    }
}

/// Spawn a background task that bridges the event bus to the orchestrator.
///
/// For every [`Event::UserMessage`] received, the bridge calls
/// [`Orchestrator::handle_message`] and publishes the response as
/// [`Event::AgentDelta`] followed by [`Event::AgentComplete`].
///
/// Because [`Orchestrator`] is not `Send` (it transitively contains SQLite
/// internals), the handler runs on a dedicated OS thread with its own
/// single-threaded tokio runtime. A normal `tokio::spawn` listener on the
/// caller's runtime forwards events over an mpsc channel.
pub fn spawn_orchestrator_bridge(
    orchestrator: Orchestrator,
    event_bus: Arc<EventBus>,
) -> JoinHandle<()> {
    let (tx, rx) = mpsc::channel::<BridgeRequest>(64);

    // Wrap so we can move across thread boundary
    let send_orch = SendOrchestrator(orchestrator);

    // Dedicated thread for the non-Send orchestrator
    let bus = Arc::clone(&event_bus);
    std::thread::Builder::new()
        .name("orchestrator-bridge".into())
        .spawn(move || {
            // Move the whole SendOrchestrator into the closure (not just .0)
            // so the unsafe Send impl is what the compiler sees.
            let wrapper = send_orch;
            run_handler(wrapper.0, rx, bus);
        })
        .expect("failed to spawn orchestrator bridge thread");

    // Listener task: event bus → mpsc channel (runs on the main tokio runtime)
    tokio::spawn(async move {
        let mut sub = event_bus.subscribe();
        loop {
            match sub.recv().await {
                Ok(Event::UserMessage {
                    content,
                    source,
                    timestamp: _,
                }) => {
                    if tx.send(BridgeRequest { content, source }).await.is_err() {
                        break; // handler dropped
                    }
                }
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!("Orchestrator bridge listener lagged, skipped {n} events");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    warn!("Event bus closed, bridge listener shutting down");
                    break;
                }
            }
        }
    })
}

/// Runs the orchestrator handler loop on a single-threaded tokio runtime.
fn run_handler(
    mut orchestrator: Orchestrator,
    mut rx: mpsc::Receiver<BridgeRequest>,
    event_bus: Arc<EventBus>,
) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("failed to build orchestrator bridge runtime");

    let local = tokio::task::LocalSet::new();

    local.block_on(&rt, async move {
        while let Some(req) = rx.recv().await {
            let session_id = session_id_for(&req.source);
            match orchestrator.handle_message(&req.content, req.source).await {
                Ok(text) => {
                    event_bus.publish(Event::AgentDelta {
                        agent_name: "orchestrator".to_string(),
                        content: text,
                        session_id: session_id.clone(),
                    });
                    event_bus.publish(Event::AgentComplete {
                        agent_name: "orchestrator".to_string(),
                        session_id,
                    });
                }
                Err(e) => {
                    error!("Orchestrator failed to handle message: {e:#}");
                }
            }
        }
    });
}
