//! Terminal UI powered by ratatui + crossterm.

#[cfg(feature = "tui")]
use std::io::{self, Stdout};
#[cfg(feature = "tui")]
use std::time::Duration;

#[cfg(feature = "tui")]
use crossterm::{
    event::{self, Event as CEvent, KeyCode, KeyModifiers},
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    ExecutableCommand,
};
#[cfg(feature = "tui")]
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame, Terminal,
};
#[cfg(feature = "tui")]
use tokio::sync::broadcast;

#[cfg(feature = "tui")]
use crate::event_bus::{Event, MessageSource};

/// A chat message for display.
#[cfg(feature = "tui")]
#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub sender: String,
    pub content: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub is_streaming: bool,
}

/// The TUI application state.
#[cfg(feature = "tui")]
pub struct TuiApp {
    messages: Vec<ChatMessage>,
    input: String,
    input_cursor: usize,
    scroll_offset: u16,
    squad_name: Option<String>,
    agent_count: usize,
    should_quit: bool,
    event_sender: broadcast::Sender<Event>,
}

#[cfg(feature = "tui")]
impl TuiApp {
    /// Create a new TUI application with the given event bus sender.
    pub fn new(event_sender: broadcast::Sender<Event>) -> Self {
        Self {
            messages: Vec::new(),
            input: String::new(),
            input_cursor: 0,
            scroll_offset: 0,
            squad_name: None,
            agent_count: 0,
            should_quit: false,
            event_sender,
        }
    }

    /// Run the TUI event loop.
    pub async fn run(&mut self) -> anyhow::Result<()> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        stdout.execute(EnterAlternateScreen)?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        let mut event_rx = self.event_sender.subscribe();

        let result = self.event_loop(&mut terminal, &mut event_rx).await;

        disable_raw_mode()?;
        terminal.backend_mut().execute(LeaveAlternateScreen)?;
        terminal.show_cursor()?;

        result
    }

    async fn event_loop(
        &mut self,
        terminal: &mut Terminal<CrosstermBackend<Stdout>>,
        event_rx: &mut broadcast::Receiver<Event>,
    ) -> anyhow::Result<()> {
        let tick_rate = Duration::from_millis(100);

        loop {
            terminal.draw(|f| self.render(f))?;

            if self.should_quit {
                break;
            }

            tokio::select! {
                _ = tokio::time::sleep(tick_rate) => {
                    // Check for crossterm events (non-blocking)
                    while event::poll(Duration::from_millis(0))? {
                        if let CEvent::Key(key) = event::read()? {
                            self.handle_key(key.code, key.modifiers);
                        }
                    }
                }
                result = event_rx.recv() => {
                    match result {
                        Ok(event) => self.handle_bus_event(event),
                        Err(broadcast::error::RecvError::Lagged(_)) => {}
                        Err(broadcast::error::RecvError::Closed) => {
                            self.should_quit = true;
                        }
                    }
                }
            }
        }

        Ok(())
    }

    fn handle_key(&mut self, code: KeyCode, modifiers: KeyModifiers) {
        match (code, modifiers) {
            (KeyCode::Char('c'), KeyModifiers::CONTROL) => {
                self.should_quit = true;
            }
            (KeyCode::Enter, _) if !self.input.is_empty() => {
                let content = self.input.drain(..).collect::<String>();
                self.input_cursor = 0;

                self.messages.push(ChatMessage {
                    sender: "user".to_string(),
                    content: content.clone(),
                    timestamp: chrono::Utc::now(),
                    is_streaming: false,
                });

                let _ = self.event_sender.send(Event::UserMessage {
                    content,
                    source: MessageSource::Tui,
                    timestamp: chrono::Utc::now(),
                });

                // Auto-scroll to bottom
                self.scroll_offset = 0;
            }
            (KeyCode::Backspace, _) if self.input_cursor > 0 => {
                self.input_cursor -= 1;
                self.input.remove(self.input_cursor);
            }
            (KeyCode::Left, _) if self.input_cursor > 0 => {
                self.input_cursor -= 1;
            }
            (KeyCode::Right, _) if self.input_cursor < self.input.len() => {
                self.input_cursor += 1;
            }
            (KeyCode::Up, _) => {
                self.scroll_offset = self.scroll_offset.saturating_add(1);
            }
            (KeyCode::Down, _) => {
                self.scroll_offset = self.scroll_offset.saturating_sub(1);
            }
            (KeyCode::Char(c), KeyModifiers::NONE | KeyModifiers::SHIFT) => {
                self.input.insert(self.input_cursor, c);
                self.input_cursor += 1;
            }
            _ => {}
        }
    }

    fn handle_bus_event(&mut self, event: Event) {
        match event {
            Event::AgentDelta {
                agent_name,
                content,
                ..
            } => {
                // Find existing streaming message from this agent, or create one
                if let Some(msg) = self
                    .messages
                    .iter_mut()
                    .rev()
                    .find(|m| m.sender == agent_name && m.is_streaming)
                {
                    msg.content.push_str(&content);
                } else {
                    self.messages.push(ChatMessage {
                        sender: agent_name,
                        content,
                        timestamp: chrono::Utc::now(),
                        is_streaming: true,
                    });
                }
            }
            Event::AgentComplete { agent_name, .. } => {
                if let Some(msg) = self
                    .messages
                    .iter_mut()
                    .rev()
                    .find(|m| m.sender == agent_name && m.is_streaming)
                {
                    msg.is_streaming = false;
                }
            }
            Event::SquadUpdated { squad_id, action } => {
                self.squad_name = Some(squad_id);
                if action == "agent_added" {
                    self.agent_count += 1;
                } else if action == "agent_removed" {
                    self.agent_count = self.agent_count.saturating_sub(1);
                }
            }
            Event::System { level, message } => {
                self.messages.push(ChatMessage {
                    sender: format!("system:{level}"),
                    content: message,
                    timestamp: chrono::Utc::now(),
                    is_streaming: false,
                });
            }
            Event::UserMessage { .. } => {
                // Ignore user messages from other sources to avoid duplicates
            }
        }
    }

    fn render(&self, frame: &mut Frame) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3), // Status bar
                Constraint::Min(1),    // Chat area
                Constraint::Length(3), // Input area
            ])
            .split(frame.area());

        // Status bar
        let squad_display = self.squad_name.as_deref().unwrap_or("none");
        let status_text = format!(
            " io v0.1.0 | Squad: {} | Agents: {}",
            squad_display, self.agent_count
        );
        let status = Paragraph::new(status_text)
            .style(
                Style::default()
                    .fg(Color::White)
                    .bg(Color::DarkGray)
                    .add_modifier(Modifier::BOLD),
            )
            .block(Block::default().borders(Borders::BOTTOM));
        frame.render_widget(status, chunks[0]);

        // Chat area
        let chat_lines = self.build_chat_lines();
        let visible_height = chunks[1].height.saturating_sub(2) as usize;
        let total_lines = chat_lines.len();
        let skip = if self.scroll_offset == 0 {
            total_lines.saturating_sub(visible_height)
        } else {
            total_lines
                .saturating_sub(visible_height)
                .saturating_sub(self.scroll_offset as usize)
        };

        let chat = Paragraph::new(chat_lines)
            .block(
                Block::default()
                    .borders(Borders::LEFT | Borders::RIGHT)
                    .title(" Chat "),
            )
            .wrap(Wrap { trim: false })
            .scroll((skip as u16, 0));
        frame.render_widget(chat, chunks[1]);

        // Input area
        let input_display = format!(" > {}", self.input);
        let input = Paragraph::new(input_display)
            .style(Style::default().fg(Color::White))
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" Input (Ctrl+C to quit) "),
            );
        frame.render_widget(input, chunks[2]);

        // Place cursor
        let cursor_x = chunks[2].x + 3 + self.input_cursor as u16;
        let cursor_y = chunks[2].y + 1;
        frame.set_cursor_position((cursor_x, cursor_y));
    }

    fn build_chat_lines(&self) -> Vec<Line<'_>> {
        let mut lines: Vec<Line> = Vec::new();

        for msg in &self.messages {
            let (sender_style, prefix) = if msg.sender == "user" {
                (
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                    "[user]",
                )
            } else if msg.sender.starts_with("system:") {
                (
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                    "[system]",
                )
            } else {
                (
                    Style::default()
                        .fg(Color::Green)
                        .add_modifier(Modifier::BOLD),
                    "",
                )
            };

            let sender_display = if prefix.is_empty() {
                format!("[{}]", msg.sender)
            } else {
                prefix.to_string()
            };

            let streaming_indicator = if msg.is_streaming { " ▍" } else { "" };

            lines.push(Line::from(vec![
                Span::styled(sender_display, sender_style),
                Span::raw(" "),
                Span::raw(msg.content.as_str()),
                Span::styled(streaming_indicator, Style::default().fg(Color::DarkGray)),
            ]));
            lines.push(Line::from(""));
        }

        lines
    }
}
