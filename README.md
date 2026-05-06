# io-daemon

A personal AI assistant daemon powered by the GitHub Copilot SDK, featuring a dynamic multi-agent "squad" architecture.

[![CI](https://github.com/michaeljolley/io/actions/workflows/ci.yml/badge.svg)](https://github.com/michaeljolley/io/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Features

- **Orchestrator** — routes requests to specialized agent squads (never generates directly)
- **Dynamic Squads** — per-project teams of specialized agents that persist and can be recalled
- **Agent Lifecycle** — agents can be hired, retired, and transitioned between squads
- **Knowledge System** — SQLite FTS5 + markdown wiki for long-term memory and cross-squad knowledge sharing
- **Terminal TUI** — ratatui-based chat interface
- **Telegram Bot** — teloxide-powered mobile interface with authentication
- **Self-Updating** — checks GitHub Releases and auto-applies updates
- **Tool System** — file ops, shell commands, web fetch, wiki, and calendar
- **Model Fallback** — tiered model selection with automatic fallback chains
- **Cost Tracking** — usage monitoring with budget warnings

## Installation

### GitHub Releases

Download a prebuilt binary from
[Releases](https://github.com/michaeljolley/io/releases) for your platform:

| Platform       | Target               |
| -------------- | -------------------- |
| Linux x86_64   | `x86_64-unknown-linux-gnu` |
| Windows x86_64 | `x86_64-pc-windows-msvc`  |
| macOS x86_64   | `x86_64-apple-darwin`      |
| macOS ARM64    | `aarch64-apple-darwin`     |

### Cargo Install

```bash
cargo install --git https://github.com/michaeljolley/io.git
```

### Building from Source

```bash
git clone https://github.com/michaeljolley/io.git
cd io

# Default (TUI + Telegram)
cargo build --release

# All features
cargo build --release --all-features

# TUI only
cargo build --release --no-default-features --features tui
```

#### Feature Flags

| Flag          | Default | Description                          |
| ------------- | ------- | ------------------------------------ |
| `tui`         | ✅      | Terminal UI via ratatui              |
| `telegram`    | ✅      | Telegram bot via teloxide            |
| `web`         | —       | Future Vue 3 web frontend           |
| `copilot-sdk` | —       | Use real GitHub Copilot SDK crate    |

## Getting Started

1. **Authenticate with GitHub Copilot** — ensure you have a valid Copilot
   subscription and have authenticated via `gh auth login`.

2. **Create a config file** at `~/.io-daemon/config.toml`:

   ```toml
   data_dir = "~/.io-daemon"

   [models]
   default = "claude-sonnet-4-5"
   fallback_chain = ["claude-sonnet-4-5", "gpt-4.1"]

   [telegram]
   bot_token = "YOUR_BOT_TOKEN"
   allowed_users = ["yourusername"]

   [update]
   enabled = true
   check_interval_hours = 12
   auto_apply = true
   ```

3. **Run the daemon:**

   ```bash
   io-daemon
   ```

## Project Structure

```
src/
├── main.rs              # Entry point, CLI, initialization
├── config.rs            # TOML config with defaults
├── event_bus.rs         # Tokio broadcast event system
├── db.rs                # SQLite with FTS5 migrations
├── copilot.rs           # GitHub Copilot SDK facade
├── orchestrator/mod.rs  # Request routing, squad recall
├── squad/
│   ├── mod.rs           # Squad CRUD, agent management
│   └── lifecycle.rs     # Charter templates, state machine
├── routing.rs           # @mention parsing, fan-out
├── session_pool.rs      # Semaphore-based session pool
├── memory.rs            # Knowledge store, episode summarizer
├── knowledge_sharing.rs # Cross-squad learning
├── tools/
│   ├── mod.rs           # Tool trait, registry
│   ├── file_ops.rs      # File read/write/search
│   ├── shell.rs         # Command execution
│   ├── web.rs           # URL fetching
│   ├── wiki.rs          # Wiki CRUD
│   └── calendar.rs      # Event management
├── interfaces/
│   ├── mod.rs           # Feature-gated modules
│   ├── tui.rs           # Ratatui terminal UI
│   └── telegram.rs      # Teloxide bot
├── updater.rs           # Self-update from GitHub Releases
├── fallback.rs          # Model selection + fallback
├── shutdown.rs          # Graceful shutdown controller
├── cost.rs              # Usage tracking
└── models/mod.rs        # Shared types
```

## Architecture

```
User → [TUI / Telegram] → Event Bus → Orchestrator → Squad Manager → Agents → Copilot SDK
```

The **Orchestrator** receives every user message and routes it to the
appropriate squad — it never generates responses directly. Each **Squad** is a
persistent, per-project team of specialized agents that can be hired, retired,
or transferred. Agents share knowledge through a SQLite FTS5-backed
**Knowledge System** with a markdown wiki, enabling cross-squad learning.

The daemon communicates with GitHub Copilot models through a tiered
**Model Fallback** chain, automatically stepping down to cheaper models when
primary models are unavailable. A **Cost Tracker** monitors token usage and
issues budget warnings.

## Roadmap

- Vue 3 web frontend with WebSocket relay
- Skills marketplace integration ([skills.sh](https://skills.sh))
- Full event loop wiring

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Code of Conduct

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## License

This project is licensed under the [MIT License](LICENSE).
