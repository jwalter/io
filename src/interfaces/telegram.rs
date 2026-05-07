//! Telegram bot interface powered by teloxide.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use teloxide::prelude::*;
use teloxide::types::ChatAction;
use tokio::sync::broadcast;

use crate::config::TelegramConfig;
use crate::db::Database;
use crate::event_bus::{Event, MessageSource};

type ChatRegistry = Arc<Mutex<HashMap<String, ChatId>>>;

/// Shared dependencies for command handlers.
#[derive(Clone)]
pub struct CommandContext {
    pub db: Arc<Mutex<Database>>,
}

pub struct TelegramBot {
    config: TelegramConfig,
    event_sender: broadcast::Sender<Event>,
    chat_registry: ChatRegistry,
    command_context: Option<CommandContext>,
}

impl TelegramBot {
    pub fn new(config: TelegramConfig, event_sender: broadcast::Sender<Event>) -> Self {
        Self {
            config,
            event_sender,
            chat_registry: Arc::new(Mutex::new(HashMap::new())),
            command_context: None,
        }
    }

    /// Set the command context for handling /squad and /wiki commands.
    pub fn set_command_context(&mut self, ctx: CommandContext) {
        self.command_context = Some(ctx);
    }

    /// Start the Telegram bot (runs until shutdown signal).
    pub async fn run(&self) -> anyhow::Result<()> {
        let bot = Bot::new(&self.config.bot_token);
        let event_sender = self.event_sender.clone();
        let allowed_users = self.config.allowed_users.clone();
        let chat_registry = self.chat_registry.clone();
        let cmd_ctx = self.command_context.clone();

        let handler = Update::filter_message().endpoint(move |bot: Bot, msg: Message| {
            let sender = event_sender.clone();
            let allowed = allowed_users.clone();
            let registry = chat_registry.clone();
            let cmd_ctx = cmd_ctx.clone();
            async move {
                let username = msg
                    .from
                    .as_ref()
                    .and_then(|u| u.username.clone())
                    .unwrap_or_default();

                if !allowed.is_empty() && !allowed.contains(&username) {
                    bot.send_message(msg.chat.id, "Unauthorized.").await?;
                    return respond(());
                }

                if let Some(text) = msg.text() {
                    if text.starts_with('/') {
                        handle_command(&bot, &msg, text, &sender, cmd_ctx.as_ref()).await?;
                        return respond(());
                    }

                    // Send typing indicator so the user knows we received their message
                    let _ = bot
                        .send_chat_action(msg.chat.id, ChatAction::Typing)
                        .await;

                    let session_id = format!("telegram-{}", msg.chat.id.0);
                    if let Ok(mut reg) = registry.lock() {
                        reg.insert(session_id, msg.chat.id);
                    }

                    let _ = sender.send(Event::UserMessage {
                        content: text.to_string(),
                        source: MessageSource::Telegram {
                            chat_id: msg.chat.id.0,
                        },
                        timestamp: chrono::Utc::now(),
                    });
                }

                respond(())
            }
        });

        Dispatcher::builder(bot, handler)
            .enable_ctrlc_handler()
            .build()
            .dispatch()
            .await;

        Ok(())
    }

    /// Start a listener that forwards agent responses back to Telegram.
    pub async fn start_response_listener(&self, mut event_rx: broadcast::Receiver<Event>) {
        let bot = Bot::new(&self.config.bot_token);
        let chat_registry = self.chat_registry.clone();
        let mut buffer: HashMap<String, String> = HashMap::new();
        let mut typing_sent: HashMap<String, tokio::time::Instant> = HashMap::new();

        while let Ok(event) = event_rx.recv().await {
            match event {
                Event::AgentDelta {
                    agent_name: _,
                    content,
                    session_id,
                } => {
                    buffer.entry(session_id.clone()).or_default().push_str(&content);

                    // Re-send typing indicator every 4 seconds to keep it active
                    let should_send = typing_sent
                        .get(&session_id)
                        .map(|last| last.elapsed() >= std::time::Duration::from_secs(4))
                        .unwrap_or(true);

                    if should_send {
                        let chat_id = chat_registry
                            .lock()
                            .ok()
                            .and_then(|reg| reg.get(&session_id).copied());

                        if let Some(chat_id) = chat_id {
                            let _ = bot
                                .send_chat_action(chat_id, ChatAction::Typing)
                                .await;
                        }
                        typing_sent.insert(session_id, tokio::time::Instant::now());
                    }
                }
                Event::AgentComplete {
                    agent_name,
                    session_id,
                } => {
                    typing_sent.remove(&session_id);

                    if let Some(full_response) = buffer.remove(&session_id) {
                        let chat_id = chat_registry
                            .lock()
                            .ok()
                            .and_then(|reg| reg.get(&session_id).copied());

                        if let Some(chat_id) = chat_id {
                            // Telegram limits messages to 4096 characters
                            const MAX_LEN: usize = 4096;
                            let chunks: Vec<&str> = if full_response.len() <= MAX_LEN {
                                vec![&full_response]
                            } else {
                                full_response
                                    .as_bytes()
                                    .chunks(MAX_LEN)
                                    .map(|chunk| std::str::from_utf8(chunk).unwrap_or(""))
                                    .filter(|s| !s.is_empty())
                                    .collect()
                            };

                            for chunk in chunks {
                                if let Err(e) = bot.send_message(chat_id, chunk).await {
                                    tracing::error!(
                                        agent = %agent_name,
                                        chat_id = %chat_id,
                                        "Failed to send Telegram response: {e}"
                                    );
                                }
                            }
                        } else {
                            tracing::warn!(
                                agent = %agent_name,
                                session_id = %session_id,
                                "No chat_id found for session; dropping response ({} chars)",
                                full_response.len()
                            );
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// Handle slash commands.
async fn handle_command(
    bot: &Bot,
    msg: &Message,
    text: &str,
    _event_sender: &broadcast::Sender<Event>,
    cmd_ctx: Option<&CommandContext>,
) -> Result<(), teloxide::RequestError> {
    let parts: Vec<&str> = text.splitn(2, ' ').collect();
    let command = parts[0].split('@').next().unwrap_or(parts[0]);

    match command {
        "/start" => {
            bot.send_message(
                msg.chat.id,
                "👋 io ready. Send me a message to get started.",
            )
            .await?;
        }
        "/status" => {
            bot.send_message(msg.chat.id, "🟢 io is running.").await?;
        }
        "/squad" => {
            let response = match cmd_ctx {
                Some(ctx) => {
                    let db = ctx.db.lock().unwrap();
                    match db.list_squads() {
                        Ok(squads) if squads.is_empty() => "No active squads.".to_string(),
                        Ok(squads) => {
                            let mut lines = vec!["📋 Active Squads:".to_string(), String::new()];
                            for squad in &squads {
                                let agents = db.get_squad_agents(&squad.id).unwrap_or_default();
                                lines.push(format!(
                                    "🔹 {} ({} agents)",
                                    squad.project_slug,
                                    agents.len()
                                ));
                                for agent in &agents {
                                    lines.push(format!("  • {} ({:?})", agent.name, agent.status));
                                }
                            }
                            lines.join("\n")
                        }
                        Err(e) => format!("Error listing squads: {e}"),
                    }
                }
                None => "Squad system not initialized.".to_string(),
            };
            bot.send_message(msg.chat.id, response).await?;
        }
        "/help" => {
            let help_text = "Available commands:\n\
                /start - Initialize bot\n\
                /status - Check daemon status\n\
                /squad - Show active squad info\n\
                /wiki <query> - Search wiki\n\
                /help - Show this message";
            bot.send_message(msg.chat.id, help_text).await?;
        }
        "/wiki" => {
            let query = parts.get(1).unwrap_or(&"").trim();
            if query.is_empty() {
                bot.send_message(msg.chat.id, "Usage: /wiki <query>")
                    .await?;
            } else {
                let response = match cmd_ctx {
                    Some(ctx) => {
                        let db = ctx.db.lock().unwrap();
                        match db.search_knowledge(query, 5) {
                            Ok(results) if results.is_empty() => {
                                format!("No wiki entries found for: {query}")
                            }
                            Ok(results) => {
                                let mut lines = vec![
                                    format!("📚 Wiki results for \"{query}\":"),
                                    String::new(),
                                ];
                                for (i, (title, content)) in results.iter().enumerate() {
                                    let snippet: String = content.chars().take(200).collect();
                                    let ellipsis = if content.len() > 200 { "..." } else { "" };
                                    lines.push(format!(
                                        "{}. **{}** — {}{}",
                                        i + 1,
                                        title,
                                        snippet,
                                        ellipsis
                                    ));
                                }
                                lines.join("\n")
                            }
                            Err(e) => format!("Error searching wiki: {e}"),
                        }
                    }
                    None => "Wiki system not initialized.".to_string(),
                };
                bot.send_message(msg.chat.id, response).await?;
            }
        }
        _ => {
            bot.send_message(msg.chat.id, "Unknown command. Try /help")
                .await?;
        }
    }

    Ok(())
}
