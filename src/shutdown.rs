use tokio::signal;
use tokio::sync::broadcast;

/// Shutdown coordinator — broadcasts shutdown signal to all components.
pub struct ShutdownController {
    sender: broadcast::Sender<()>,
}

impl ShutdownController {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(1);
        Self { sender }
    }

    /// Get a receiver that will be notified on shutdown.
    pub fn subscribe(&self) -> broadcast::Receiver<()> {
        self.sender.subscribe()
    }

    /// Trigger shutdown (called by signal handler or explicit request).
    pub fn trigger(&self) {
        let _ = self.sender.send(());
    }

    /// Wait for Ctrl+C and trigger shutdown.
    pub async fn wait_for_signal(&self) {
        signal::ctrl_c()
            .await
            .expect("Failed to listen for Ctrl+C");
        tracing::info!("Shutdown signal received");
        self.trigger();
    }
}

impl Default for ShutdownController {
    fn default() -> Self {
        Self::new()
    }
}
