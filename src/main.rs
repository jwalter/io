// Allow dead code during early development — modules are scaffolded but not fully wired yet
#![allow(dead_code, unused_imports)]

mod bridge;
mod config;
mod copilot;
mod cost;
mod db;
mod event_bus;
mod fallback;
mod interfaces;
mod knowledge_sharing;
mod memory;
mod models;
mod orchestrator;
mod routing;
mod session_pool;
mod shutdown;
mod squad;
mod tools;
mod updater;

use std::sync::Arc;

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
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                cli.log_level
                    .parse()
                    .unwrap_or_else(|_| "info".parse().unwrap())
            }),
        )
        .init();

    tracing::info!("io-daemon starting...");

    // Load config
    let config = config::Config::load(cli.config.as_deref())?;
    tracing::info!(?config.data_dir, "Configuration loaded");

    // Initialize database
    let db = db::Database::init(&config.data_dir)?;
    tracing::info!("Database initialized");

    // Initialize event bus
    let event_bus = event_bus::EventBus::new();
    tracing::info!("Event bus ready");

    // Wrap shared resources in Arc
    let config = Arc::new(config);
    let event_bus = Arc::new(event_bus);
    let db = Arc::new(std::sync::Mutex::new(db));

    // Create squad manager
    #[allow(clippy::arc_with_non_send_sync)]
    let squad_manager = Arc::new(squad::SquadManager::new(
        config.data_dir.clone(),
        Arc::new(db::Database::init(&config.data_dir)?),
    ));

    // Create orchestrator
    let orchestrator = orchestrator::Orchestrator::new(
        config.clone(),
        squad_manager.clone(),
        event_bus.clone(),
    );

    // Spawn orchestrator bridge
    let _bridge_handle = bridge::spawn_orchestrator_bridge(orchestrator, event_bus.clone());
    tracing::info!("Orchestrator bridge started");

    // Conditionally start Telegram bot
    #[cfg(feature = "telegram")]
    {
        if let Some(ref telegram_config) = config.telegram {
            let mut bot =
                interfaces::telegram::TelegramBot::new(telegram_config.clone(), event_bus.sender());
            bot.set_command_context(interfaces::telegram::CommandContext { db: db.clone() });

            let bot = Arc::new(bot);

            // Start response listener in background
            let bot_listener = bot.clone();
            let event_rx = event_bus.subscribe();
            tokio::spawn(async move {
                bot_listener.start_response_listener(event_rx).await;
            });

            // Start the Telegram dispatcher in background
            let bot_runner = bot.clone();
            tokio::spawn(async move {
                if let Err(e) = bot_runner.run().await {
                    tracing::error!("Telegram bot exited with error: {e:#}");
                }
            });

            tracing::info!("Telegram bot started");
        }
    }

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

    tracing::info!("io-daemon running. Press Ctrl+C to stop.");
    tokio::signal::ctrl_c().await?;
    tracing::info!("Shutting down...");

    Ok(())
}
