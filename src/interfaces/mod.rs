//! User-facing interfaces (TUI, Telegram, future Web).

#[cfg(feature = "tui")]
pub mod tui;

#[cfg(feature = "telegram")]
pub mod telegram;
