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
mod skills;
mod squad;
mod tools;
mod updater;

use std::sync::Arc;

use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "io", version, about = "Personal AI assistant daemon")]
struct Cli {
    /// Run in headless daemon mode (no TUI)
    #[arg(short, long, default_value_t = false)]
    daemon: bool,

    /// Path to config file (default: ~/.io/config.toml)
    #[arg(short, long)]
    config: Option<std::path::PathBuf>,

    /// Log level
    #[arg(long, default_value = "info")]
    log_level: String,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(clap::Subcommand, Debug)]
enum Commands {
    /// Launch the interactive chat TUI
    Chat,
    /// Manage installed skills
    Skill {
        #[command(subcommand)]
        action: SkillAction,
    },
}

#[derive(clap::Subcommand, Debug)]
enum SkillAction {
    /// List installed skills
    List,
    /// Search skills.sh registry
    Search {
        /// Search query
        query: String,
    },
    /// Install a skill from skills.sh (format: owner/repo@slug)
    Add {
        /// Install specifier (e.g., anthropics/skills@pdf)
        spec: String,
    },
    /// Remove an installed skill
    Remove {
        /// Skill name to remove
        name: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Handle subcommands early (before daemon startup)
    match cli.command {
        Some(Commands::Skill { action }) => return handle_skill_command(action).await,
        Some(Commands::Chat) => {} // Fall through to normal startup with TUI forced
        None => {}                 // Fall through to normal startup
    }

    // Determine if TUI should run: `io chat` forces it, `io --daemon` disables it
    let run_tui = cli.command.is_some() || !cli.daemon;

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

    tracing::info!("io starting...");

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

    // Create orchestrator with tool registry and skill catalog
    let tool_registry = tools::ToolRegistry::register_defaults();
    let skill_entries = skills::scan_all_skills(None);
    let skill_catalog = skills::SkillCatalog::new(skill_entries);
    tracing::info!(skills = skill_catalog.len(), "Scanned for installed skills");
    let orchestrator = orchestrator::Orchestrator::new(
        config.clone(),
        squad_manager.clone(),
        tool_registry,
        skill_catalog,
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

    // Run TUI or daemon mode
    #[cfg(feature = "tui")]
    if run_tui {
        tracing::info!("Starting interactive TUI...");
        let mut tui = interfaces::tui::TuiApp::new(event_bus.sender());
        tui.run().await?;
        tracing::info!("TUI exited, shutting down...");
    } else {
        tracing::info!("io running in daemon mode. Press Ctrl+C to stop.");
        tokio::signal::ctrl_c().await?;
        tracing::info!("Shutting down...");
    }

    #[cfg(not(feature = "tui"))]
    {
        let _ = run_tui; // suppress unused variable warning
        tracing::info!("io running in daemon mode. Press Ctrl+C to stop.");
        tokio::signal::ctrl_c().await?;
        tracing::info!("Shutting down...");
    }

    Ok(())
}

/// Handle `io skill` subcommands.
async fn handle_skill_command(action: SkillAction) -> anyhow::Result<()> {
    match action {
        SkillAction::List => {
            let entries = skills::scan_all_skills(None);
            if entries.is_empty() {
                println!("No skills installed.");
                println!("\nInstall skills with: io skill add <owner/repo@slug>");
                println!("Search for skills:   io skill search <query>");
            } else {
                println!("Installed skills ({}):\n", entries.len());
                for entry in &entries {
                    let scope = match entry.scope {
                        skills::types::SkillScope::User => "user",
                        skills::types::SkillScope::Project => "project",
                    };
                    println!("  {} ({})", entry.name, scope);
                    println!("    {}", entry.description);
                    println!("    {}\n", entry.location.display());
                }
            }
        }
        SkillAction::Search { query } => {
            println!("Searching skills.sh for '{query}'...\n");
            let results = skills::registry::search_skills(&query, 10).await?;
            if results.is_empty() {
                println!("No skills found for '{query}'.");
            } else {
                println!("Found {} skills:\n", results.len());
                for skill in &results {
                    println!("  {} ({} installs)", skill.name, skill.installs);
                    println!("    Source: {}", skill.source);
                    println!("    Install: io skill add {}@{}\n", skill.source, skill.id);
                }
            }
        }
        SkillAction::Add { spec } => {
            let (owner, repo, slug) = skills::registry::parse_install_spec(&spec)?;
            println!("Installing skill '{slug}' from {owner}/{repo}...");
            let path = skills::registry::install_skill(&owner, &repo, &slug).await?;
            println!("Installed to {}", path.display());
            println!(
                "\nRestart IO to activate the skill, or it will be picked up on next startup."
            );
        }
        SkillAction::Remove { name } => {
            skills::registry::remove_skill(&name)?;
            println!("Removed skill '{name}'.");
        }
    }
    Ok(())
}
