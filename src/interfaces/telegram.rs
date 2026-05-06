//! Telegram bot interface powered by teloxide.

use std::collections::HashMap;

use teloxide::prelude::*;
use tokio::sync::broadcast;

use crate::config::TelegramConfig;
use crate::event_bus::{Event, MessageSource};

pub struct TelegramBot {
    config: TelegramConfig,
    event_sender: broadcast::Sender<Event>,
}

impl TelegramBot {
    pub fn new(config: TelegramConfig, event_sender: broadcast::Sender<Event>) -> Self {
        Self {
            config,
            event_sender,
        }
    }

    /// Start the Telegram bot (runs until shutdown signal).
    pub async fn run(&self) -> anyhow::Result<()> {
        let bot = Bot::new(&self.config.bot_token);
        let event_sender = self.event_sender.clone();
        let allowed_users = self.config.allowed_users.clone();

        let handler = Update::filter_message().endpoint(
            move |bot: Bot, msg: Message| {
                let sender = event_sender.clone();
                let allowed = allowed_users.clone();
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
                            handle_command(&bot, &msg, text, &sender).await?;
                            return respond(());
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
            },
        );

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
        let mut buffer: HashMap<String, String> = HashMap::new();

        while let Ok(event) = event_rx.recv().await {
            match event {
                Event::AgentDelta {
                    agent_name: _,
                    content,
                    session_id,
                } => {
                    buffer.entry(session_id).or_default().push_str(&content);
                }
                Event::AgentComplete {
                    agent_name,
                    session_id,
                } => {
                    if let Some(full_response) = buffer.remove(&session_id) {
                        // TODO: Track which chat_id to respond to per session
                        tracing::debug!(
                            agent = %agent_name,
                            "Response complete: {} chars",
                            full_response.len()
                        );
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
) -> Result<(), teloxide::RequestError> {
    let parts: Vec<&str> = text.splitn(2, ' ').collect();
    let command = parts[0].split('@').next().unwrap_or(parts[0]);

    match command {
        "/start" => {
            bot.send_message(
                msg.chat.id,
                "👋 io-daemon ready. Send me a message to get started.",
            )
            .await?;
        }
        "/status" => {
            bot.send_message(msg.chat.id, "🟢 io-daemon is running.")
                .await?;
        }
        "/squad" => {
            bot.send_message(msg.chat.id, "Squad info will appear here.")
                .await?;
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
            let query = parts.get(1).unwrap_or(&"");
            bot.send_message(msg.chat.id, format!("🔍 Searching wiki for: {}", query))
                .await?;
        }
        _ => {
            bot.send_message(msg.chat.id, "Unknown command. Try /help")
                .await?;
        }
    }

    Ok(())
}
