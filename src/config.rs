use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_data_dir")]
    pub data_dir: PathBuf,

    #[serde(default)]
    pub models: ModelConfig,

    #[serde(default)]
    pub telegram: Option<TelegramConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelConfig {
    #[serde(default = "default_model")]
    pub default: String,

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
        .join(".io-daemon")
}

fn default_model() -> String {
    "claude-sonnet-4-5".to_string()
}

fn default_fallback_chain() -> Vec<String> {
    vec![
        "claude-sonnet-4-5".to_string(),
        "gpt-4.1".to_string(),
    ]
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
        }
    }
}
