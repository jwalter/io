use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_data_dir")]
    pub data_dir: PathBuf,

    #[serde(default)]
    pub models: ModelConfig,

    #[serde(default)]
    pub telegram: Option<TelegramConfig>,

    #[serde(default)]
    pub update: UpdateConfig,

    #[serde(default)]
    pub history: HistoryConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateConfig {
    #[serde(default = "default_update_enabled")]
    pub enabled: bool,

    #[serde(default = "default_check_interval_hours")]
    pub check_interval_hours: u64,

    #[serde(default = "default_auto_apply")]
    pub auto_apply: bool,
}

fn default_auto_apply() -> bool {
    true
}

fn default_update_enabled() -> bool {
    true
}

fn default_check_interval_hours() -> u64 {
    12
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            enabled: default_update_enabled(),
            check_interval_hours: default_check_interval_hours(),
            auto_apply: default_auto_apply(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryConfig {
    /// Maximum number of messages to restore from history on session resume.
    #[serde(default = "default_max_history_messages")]
    pub max_messages: usize,
}

fn default_max_history_messages() -> usize {
    50
}

impl Default for HistoryConfig {
    fn default() -> Self {
        Self {
            max_messages: default_max_history_messages(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelConfig {
    #[serde(default = "default_model")]
    pub default: String,

    /// Model to escalate to when context exceeds the default model's budget.
    #[serde(default = "default_escalation_model")]
    pub escalation: String,

    /// Token threshold to switch from default to escalation model.
    #[serde(default = "default_escalation_threshold")]
    pub escalation_threshold: usize,

    #[serde(default = "default_fallback_chain")]
    pub fallback_chain: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramConfig {
    pub bot_token: String,
    pub allowed_users: Vec<String>,
}

fn default_data_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".io")
}

fn default_model() -> String {
    "openai/gpt-5-mini".to_string()
}

fn default_escalation_model() -> String {
    "openai/gpt-5".to_string()
}

fn default_escalation_threshold() -> usize {
    8000
}

fn default_fallback_chain() -> Vec<String> {
    vec!["openai/gpt-5-mini".to_string(), "openai/gpt-5".to_string()]
}

impl Config {
    pub fn load(path: Option<&Path>) -> Result<Self> {
        let config_path = path
            .map(PathBuf::from)
            .unwrap_or_else(|| default_data_dir().join("config.toml"));

        if config_path.exists() {
            let contents = std::fs::read_to_string(&config_path)?;
            let config: Config = toml::from_str(&contents)?;
            Ok(config)
        } else {
            // Return defaults, ensure data dir exists
            let config = Config::default();
            std::fs::create_dir_all(&config.data_dir)?;
            Ok(config)
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            data_dir: default_data_dir(),
            models: ModelConfig::default(),
            telegram: None,
            update: UpdateConfig::default(),
            history: HistoryConfig::default(),
        }
    }
}
