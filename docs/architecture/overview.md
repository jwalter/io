# Architecture Overview

IO is a single Rust binary that runs as a background service, routing user messages through an orchestrator to specialized agent squads powered by the GitHub Copilot SDK.

## System Diagram

```
User → [TUI / Telegram] → Event Bus → Orchestrator → Squad Manager → Agents → Copilot SDK
```

```
┌─────────────────────────────────────────────────────────┐
│                            IO                            │
├─────────────────────────────────────────────────────────┤
│  Interfaces          │  Core                            │
│  ┌──────────┐        │  ┌─────────────────────────┐    │
│  │ TUI      │◄──────►│  │ Orchestrator            │    │
│  │ (ratatui)│        │  │  • Route messages        │    │
│  └──────────┘        │  │  • Compose/recall squads │    │
│  ┌──────────┐        │  │  • Manage sessions       │    │
│  │ Telegram │◄──────►│  └────────┬────────────────┘    │
│  │(teloxide)│        │           │                      │
│  └──────────┘        │  ┌────────▼────────────────┐    │
│                      │  │ Squad Manager            │    │
│                      │  │  • Create/recall squads  │    │
│                      │  │  • Hire new agents       │    │
│                      │  │  • Agent lifecycle       │    │
│                      │  └────────┬────────────────┘    │
│                      │           │                      │
│                      │  ┌────────▼────────────────┐    │
│                      │  │ Agent Sessions (Copilot) │    │
│                      │  │  • Parallel execution    │    │
│                      │  │  • Tool access           │    │
│                      │  │  • Streaming responses   │    │
│                      │  └────────┬────────────────┘    │
│                      │           │                      │
│  Storage             │  ┌────────▼────────────────┐    │
│  ┌──────────┐        │  │ Tool Registry            │    │
│  │ SQLite   │◄──────►│  │  • File ops              │    │
│  │ (index)  │        │  │  • Shell commands        │    │
│  └──────────┘        │  │  • Web search/fetch      │    │
│  ┌──────────┐        │  │  • Calendar              │    │
│  │ Markdown │◄──────►│  │  • Wiki/notes            │    │
│  │ (state)  │        │  └─────────────────────────┘    │
│  └──────────┘        │                                  │
├─────────────────────────────────────────────────────────┤
│  Event Bus (tokio broadcast channels)                   │
└─────────────────────────────────────────────────────────┘
```

## Key Components

### Event Bus

All communication between components flows through a tokio broadcast channel-based event bus. This decouples interfaces from core logic and makes it trivial to add new subscribers (e.g., a future WebSocket relay for the web frontend).

All event types derive `Serialize`/`Deserialize`, making them ready for WebSocket transmission.

### Orchestrator

The orchestrator is the routing brain of IO. It receives every user message and decides which squad and agent(s) should handle it. **It never generates responses directly** — it only routes.

See [Orchestrator](/architecture/orchestrator) for details.

### Squad Manager

Manages the lifecycle of agent squads — creating, recalling, and persisting them. Squads are per-project teams stored at `~/.io-daemon/squads/`.

See [Squads](/architecture/squads) for details.

### Interfaces

IO supports multiple simultaneous interfaces:

| Interface | Feature Flag | Status    |
| --------- | ------------ | --------- |
| TUI       | `tui`        | Available |
| Telegram  | `telegram`   | Available |
| Web       | `web`        | Planned   |

All interfaces subscribe to the same event bus, so they can run concurrently.

### Storage

IO uses **hybrid storage**:

- **SQLite** (with FTS5) for message indexing, search, and session history
- **Markdown files** for agent charters, squad decisions, routing rules, and the personal wiki

This combines the queryability of a database with the human-readability and version-control-friendliness of plain text.

## Async Runtime

Built on [Tokio](https://tokio.rs/) with broadcast channels for the event bus. The orchestrator runs on a dedicated OS thread due to SQLite's `!Send` constraint, communicating with the main runtime via message passing.

## Feature Flags

The binary is compiled with Cargo feature flags that enable/disable interfaces:

```bash
# Default: TUI + Telegram
cargo build --release

# TUI only
cargo build --release --no-default-features --features tui

# Telegram only
cargo build --release --no-default-features --features telegram
```
