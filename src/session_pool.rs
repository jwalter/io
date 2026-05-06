use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};
use anyhow::Result;

use crate::copilot::{CopilotManager, Session, SessionOptions};

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

/// Metadata about a pooled session.
#[derive(Debug)]
struct PooledSession {
    session: Session,
    agent_name: String,
    #[allow(dead_code)]
    squad_id: Option<String>,
    #[allow(dead_code)]
    created_at: chrono::DateTime<chrono::Utc>,
    last_used: chrono::DateTime<chrono::Utc>,
    in_use: bool,
}

/// Manages a pool of Copilot sessions with concurrency control.
pub struct SessionPool {
    config: PoolConfig,
    sessions: Arc<Mutex<HashMap<String, PooledSession>>>,
    semaphore: Arc<Semaphore>,
    copilot: Arc<Mutex<CopilotManager>>,
}

impl SessionPool {
    pub fn new(config: PoolConfig, copilot: Arc<Mutex<CopilotManager>>) -> Self {
        let max = config.max_concurrent;
        Self {
            config,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            semaphore: Arc::new(Semaphore::new(max)),
            copilot,
        }
    }

    /// Acquire or create a session for an agent.
    /// If the agent already has a session in the pool, reuse it.
    /// Otherwise, create a new one (blocking if at capacity).
    pub async fn acquire(
        &self,
        agent_name: &str,
        squad_id: Option<&str>,
        options: SessionOptions,
    ) -> Result<SessionHandle> {
        // Check if agent already has a pooled session
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(pooled) = sessions.values_mut().find(|s| s.agent_name == agent_name && !s.in_use) {
                pooled.in_use = true;
                pooled.last_used = chrono::Utc::now();
                return Ok(SessionHandle {
                    session_id: pooled.session.id.clone(),
                    pool: self.sessions.clone(),
                });
            }
        }

        // Acquire semaphore permit (blocks if at max capacity)
        let _permit = self.semaphore.acquire().await?;

        // Create new session
        let session = {
            let copilot = self.copilot.lock().await;
            copilot.create_session(options).await?
        };

        let session_id = session.id.clone();
        let now = chrono::Utc::now();

        let pooled = PooledSession {
            session,
            agent_name: agent_name.to_string(),
            squad_id: squad_id.map(|s| s.to_string()),
            created_at: now,
            last_used: now,
            in_use: true,
        };

        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(session_id.clone(), pooled);
        }

        Ok(SessionHandle {
            session_id,
            pool: self.sessions.clone(),
        })
    }

    /// Release a session back to the pool.
    pub async fn release(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().await;
        if let Some(pooled) = sessions.get_mut(session_id) {
            pooled.in_use = false;
            pooled.last_used = chrono::Utc::now();
        }
    }

    /// Get current pool status.
    pub async fn status(&self) -> PoolStatus {
        let sessions = self.sessions.lock().await;
        let total = sessions.len();
        let active = sessions.values().filter(|s| s.in_use).count();
        let idle = total - active;
        PoolStatus {
            total,
            active,
            idle,
            max_concurrent: self.config.max_concurrent,
        }
    }

    /// Remove idle sessions that have exceeded the timeout.
    pub async fn cleanup_idle(&self) {
        let timeout = chrono::Duration::seconds(self.config.idle_timeout_secs as i64);
        let cutoff = chrono::Utc::now() - timeout;

        let mut sessions = self.sessions.lock().await;
        sessions.retain(|_id, pooled| {
            if !pooled.in_use && pooled.last_used < cutoff {
                tracing::debug!(agent = %pooled.agent_name, "Removing idle session");
                false
            } else {
                true
            }
        });
    }

    /// Get a reference to a session by ID (for sending messages).
    pub async fn get_session(&self, session_id: &str) -> Option<String> {
        let sessions = self.sessions.lock().await;
        sessions.get(session_id).map(|s| s.session.id.clone())
    }
}

/// Handle returned when acquiring a session. Auto-releases on drop.
pub struct SessionHandle {
    session_id: String,
    pool: Arc<Mutex<HashMap<String, PooledSession>>>,
}

impl SessionHandle {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

impl Drop for SessionHandle {
    fn drop(&mut self) {
        let pool = self.pool.clone();
        let id = self.session_id.clone();
        // Spawn a task to release since Drop can't be async
        tokio::spawn(async move {
            let mut sessions = pool.lock().await;
            if let Some(pooled) = sessions.get_mut(&id) {
                pooled.in_use = false;
                pooled.last_used = chrono::Utc::now();
            }
        });
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::copilot::{CopilotConfig, CopilotManager};
    use tokio::sync::broadcast;
    use crate::event_bus::Event;

    async fn setup_pool() -> SessionPool {
        let (sender, _) = broadcast::channel::<Event>(16);
        let mut manager = CopilotManager::new(CopilotConfig::default(), sender);
        manager.start().await.unwrap();

        let copilot = Arc::new(Mutex::new(manager));
        SessionPool::new(PoolConfig::default(), copilot)
    }

    #[tokio::test]
    async fn test_acquire_creates_session() {
        let pool = setup_pool().await;
        let handle = pool
            .acquire(
                "test-agent",
                None,
                SessionOptions {
                    system_prompt: "test".to_string(),
                    model: None,
                    tools: vec![],
                },
            )
            .await
            .unwrap();

        assert!(!handle.session_id().is_empty());

        let status = pool.status().await;
        assert_eq!(status.total, 1);
        assert_eq!(status.active, 1);
    }

    #[tokio::test]
    async fn test_acquire_reuses_session() {
        let pool = setup_pool().await;
        let options = SessionOptions {
            system_prompt: "test".to_string(),
            model: None,
            tools: vec![],
        };

        let handle1 = pool.acquire("agent-a", None, options.clone()).await.unwrap();
        let id1 = handle1.session_id().to_string();
        pool.release(&id1).await;

        let handle2 = pool.acquire("agent-a", None, options).await.unwrap();
        assert_eq!(handle2.session_id(), id1);
    }

    #[tokio::test]
    async fn test_release_marks_idle() {
        let pool = setup_pool().await;
        let handle = pool
            .acquire(
                "test-agent",
                None,
                SessionOptions {
                    system_prompt: "test".to_string(),
                    model: None,
                    tools: vec![],
                },
            )
            .await
            .unwrap();

        let id = handle.session_id().to_string();
        pool.release(&id).await;

        let status = pool.status().await;
        assert_eq!(status.idle, 1);
        assert_eq!(status.active, 0);
    }

    #[tokio::test]
    async fn test_cleanup_removes_expired() {
        let (sender, _) = broadcast::channel::<Event>(16);
        let mut manager = CopilotManager::new(CopilotConfig::default(), sender);
        manager.start().await.unwrap();

        let copilot = Arc::new(Mutex::new(manager));
        let config = PoolConfig {
            max_concurrent: 5,
            idle_timeout_secs: 0, // immediate timeout
        };
        let pool = SessionPool::new(config, copilot);

        let handle = pool
            .acquire(
                "test-agent",
                None,
                SessionOptions {
                    system_prompt: "test".to_string(),
                    model: None,
                    tools: vec![],
                },
            )
            .await
            .unwrap();

        let id = handle.session_id().to_string();
        pool.release(&id).await;

        // Small delay to ensure the timestamp is past the cutoff
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        pool.cleanup_idle().await;

        let status = pool.status().await;
        assert_eq!(status.total, 0);
    }
}
