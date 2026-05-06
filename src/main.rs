mod config;
#[allow(dead_code)]
mod copilot;
#[allow(dead_code)]
mod cost;
mod db;
mod event_bus;
#[allow(dead_code)]
mod knowledge_sharing;
#[allow(dead_code)]
mod memory;
#[allow(dead_code)]
mod fallback;
mod models;
mod orchestrator;
mod routing;
#[allow(dead_code)]
mod session_pool;
#[allow(dead_code)]
mod shutdown;
mod squad;
mod tools;
mod interfaces;
#[allow(dead_code)]
mod updater;

use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "io-daemon", version, about = "Personal AI assistant daemon")]
struct Cli {
    /// Run in daemon mode (long-running)
    #[arg(short, long, default_value_t = true)]
    daemon: bool,

    /// Path to config file (default: ~/.io-daemon/config.toml)
    #[arg(short, long)]
    config: Option<std::path::PathBuf>,

    /// Log level
    #[arg(long, default_value = "info")]
    log_level: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| cli.log_level.parse().unwrap_or_else(|_| "info".parse().unwrap()))
        )
        .init();

    tracing::info!("io-daemon starting...");

    // Load config
    let config = config::Config::load(cli.config.as_deref())?;
    tracing::info!(?config.data_dir, "Configuration loaded");

    // Initialize database
    let _db = db::Database::init(&config.data_dir)?;
    tracing::info!("Database initialized");

    // Initialize event bus
    let event_bus = event_bus::EventBus::new();
    tracing::info!("Event bus ready");

    // Spawn self-update checker
    if config.update.enabled {
        let update_config = updater::UpdateConfig {
            enabled: config.update.enabled,
            check_interval_hours: config.update.check_interval_hours,
            auto_apply: config.update.auto_apply,
        };
        let _update_handle = updater::spawn_update_checker(update_config, event_bus.sender());
        tracing::info!("Update checker started");
    }

    tracing::info!("io-daemon initialized successfully");

    // TODO: Start orchestrator, interfaces, etc.

    Ok(())
}
