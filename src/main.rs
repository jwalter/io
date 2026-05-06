mod config;
#[allow(dead_code)]
mod copilot;
mod db;
mod event_bus;
mod models;
mod orchestrator;
mod squad;
mod tools;
mod interfaces;

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
    let _event_bus = event_bus::EventBus::new();
    tracing::info!("Event bus ready");

    tracing::info!("io-daemon initialized successfully");

    // TODO: Start orchestrator, interfaces, etc.

    Ok(())
}
