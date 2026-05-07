use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};

/// Configuration for the session pool.
#[derive(Debug, Clone)]
pub struct PoolConfig {
    /// Maximum number of concurrent sessions
    pub max_concurrent: usize,
    /// Session idle timeout in seconds before cleanup
    pub idle_timeout_secs: u64,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            max_concurrent: 5,
            idle_timeout_secs: 300,
        }
    }
}

/// Manages a pool of agent sessions with concurrency control.
///
/// TODO: Wire up with GithubModelsClient for per-agent session management.
/// Currently the orchestrator handles its own conversation history directly.
pub struct SessionPool {
    config: PoolConfig,
    semaphore: Arc<Semaphore>,
}

impl SessionPool {
    pub fn new(config: PoolConfig) -> Self {
        let max = config.max_concurrent;
        Self {
            config,
            semaphore: Arc::new(Semaphore::new(max)),
        }
    }
}

/// Status of the session pool.
#[derive(Debug, Clone)]
pub struct PoolStatus {
    pub total: usize,
    pub active: usize,
    pub idle: usize,
    pub max_concurrent: usize,
}
