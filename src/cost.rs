use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

/// A single usage record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageRecord {
    pub session_id: String,
    pub agent_name: String,
    pub squad_id: Option<String>,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost_usd: f64,
    pub timestamp: DateTime<Utc>,
}

/// Tracks token usage and estimated costs.
pub struct CostTracker {
    records: Arc<Mutex<Vec<UsageRecord>>>,
    budget_warning_usd: f64,
}

impl CostTracker {
    pub fn new(budget_warning_usd: f64) -> Self {
        Self {
            records: Arc::new(Mutex::new(Vec::new())),
            budget_warning_usd,
        }
    }

    /// Record a usage event.
    pub async fn record(&self, record: UsageRecord) {
        let mut records = self.records.lock().await;
        let total_before: f64 = records.iter().map(|r| r.estimated_cost_usd).sum();
        let total_after = total_before + record.estimated_cost_usd;

        if total_before < self.budget_warning_usd && total_after >= self.budget_warning_usd {
            tracing::warn!(
                total = total_after,
                budget = self.budget_warning_usd,
                "Budget warning threshold reached!"
            );
        }

        records.push(record);
    }

    /// Get total cost for the current session.
    pub async fn total_cost(&self) -> f64 {
        let records = self.records.lock().await;
        records.iter().map(|r| r.estimated_cost_usd).sum()
    }

    /// Get cost breakdown by agent.
    pub async fn cost_by_agent(&self) -> HashMap<String, f64> {
        let records = self.records.lock().await;
        let mut by_agent: HashMap<String, f64> = HashMap::new();
        for record in records.iter() {
            *by_agent.entry(record.agent_name.clone()).or_default() += record.estimated_cost_usd;
        }
        by_agent
    }

    /// Get cost breakdown by model.
    pub async fn cost_by_model(&self) -> HashMap<String, f64> {
        let records = self.records.lock().await;
        let mut by_model: HashMap<String, f64> = HashMap::new();
        for record in records.iter() {
            *by_model.entry(record.model.clone()).or_default() += record.estimated_cost_usd;
        }
        by_model
    }

    /// Get total tokens used.
    pub async fn total_tokens(&self) -> (u64, u64) {
        let records = self.records.lock().await;
        let input: u64 = records.iter().map(|r| r.input_tokens).sum();
        let output: u64 = records.iter().map(|r| r.output_tokens).sum();
        (input, output)
    }
}
