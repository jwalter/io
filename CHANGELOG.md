# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-05-08

### 🚀 Complete TypeScript Rewrite

IO has been completely rewritten from Rust to TypeScript, built on the GitHub Copilot SDK. This is a ground-up reimplementation with a new architecture, new dependencies, and new capabilities.

#### Added

- **Copilot SDK integration** for all LLM interactions, replacing the custom GitHub Models API client
- **Persistent orchestrator sessions** with automatic context compaction for infinite-length conversations
- **Squad system** for persistent project teams that remember decisions and context across sessions
- **Wiki-based knowledge base** at `~/.io/wiki/` for long-term memory
- **Telegram bot interface** powered by [grammy](https://grammy.dev/)
- **Terminal TUI interface** with readline-based input
- **HTTP API with SSE streaming** via Express for future web UI integration
- **Modular skill system** — install skills from git repos or the [skills.sh](https://skills.sh) registry
- **Worker agent system** for delegating complex tasks to specialized agent sessions
- **Self-update checker** to notify when new versions are available
- **Setup wizard** (`io setup`) for guided first-time configuration
- **CLI interface** with commander — `io`, `io --daemon`, `io skill` subcommands

#### Changed

- **Rewritten from Rust to TypeScript** — the entire codebase is now TypeScript with ESM modules
- **Replaced custom GitHub Models API client** with the official [Copilot SDK](https://www.npmjs.com/package/@github/copilot-sdk)
- **Replaced teloxide with grammy** for Telegram bot functionality
- **Replaced ratatui with readline** for the terminal UI
- **Replaced rusqlite with better-sqlite3** for SQLite database access
- **Replaced TOML config with JSON** — configuration now lives at `~/.io/config.json`

#### Removed

- **Direct GitHub Models API integration** — now handled entirely by the Copilot SDK
- **Custom retry/backoff logic** — handled by the Copilot SDK
- **Custom context window management** — replaced by the SDK's infinite sessions with automatic compaction
- **Model fallback chains** — the Copilot SDK manages model selection
- **Cost tracking** — no longer needed with the Copilot SDK
- **Cargo/Rust build system** — replaced by npm and TypeScript compiler
