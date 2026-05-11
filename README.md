# 🤖 IO

A personal AI assistant daemon built on the GitHub Copilot SDK. IO runs 24/7 on your machine, reachable via Telegram and a terminal TUI.

[![CI](https://github.com/michaeljolley/io/actions/workflows/ci.yml/badge.svg)](https://github.com/michaeljolley/io/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)

## ✨ Features

- **Copilot SDK Integration** — powered by GitHub's Copilot SDK for LLM conversations with tool calling
- **Multi-Interface** — Telegram bot + terminal TUI + HTTP API (future web UI)
- **Persistent Memory** — wiki-based knowledge base stored at `~/.io/wiki/`
- **Squad System** — persistent project teams that remember decisions, context, and history
- **Skills** — modular skill system; install from git repos or the [skills.sh](https://skills.sh) registry
- **Adaptive Sessions** — infinite sessions with automatic context compaction
- **Worker Agents** — delegated task execution through specialized agent sessions
- **GitHub Integration** — create, list, view, and comment on issues and PRs via the `github` tool
- **Smart Model Routing** — automatically selects the best model for each task based on complexity
- **Self-Updating** — checks for updates and can apply them automatically

## 📋 Prerequisites

- **Node.js** >= 22
- **GitHub Copilot subscription** — IO uses the Copilot SDK, which requires an active Copilot license
- **GitHub CLI** (`gh`) — required for the `github` tool (issue/PR management). Install from [cli.github.com](https://cli.github.com/) and authenticate with `gh auth login`

## 🚀 Quick Start

### Install

```bash
npm install -g heyio
```

### Setup

Run the setup wizard to configure your Telegram bot token and user ID:

```bash
io setup
```

This creates a config file at `~/.io/config.json`.

### Run

```bash
# Interactive TUI mode
io

# Background daemon (Telegram + HTTP API)
io --daemon

# Allow IO to modify its own source code
io --self-edit
```

### Headless Server (systemd)

To run IO as a background service on a headless server:

1. Authenticate the Copilot SDK: `copilot login`
2. Authenticate the GitHub CLI: `gh auth login`
3. Create a systemd service file at `/etc/systemd/system/io.service`:

```ini
[Unit]
Description=IO Personal Assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/env io --daemon
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

4. Enable and start: `systemctl enable --now io`

## 💬 CLI Usage

| Command | Description |
| --- | --- |
| `io` | Start interactive TUI mode |
| `io --daemon` | Run as background daemon (Telegram + API) |
| `io --self-edit` | Allow IO to modify its own source |
| `io setup` | Configure Telegram bot token and user ID |
| `io skill list` | List installed skills |
| `io skill add <repo-url>` | Install a skill from a git repository |
| `io skill remove <slug>` | Remove an installed skill |
| `io skill search <query>` | Search the skills.sh registry |

## ⚙️ Configuration

IO stores its configuration at `~/.io/config.json`. The setup wizard (`io setup`) handles initial configuration, but you can also edit the file directly.

```jsonc
{
  // Telegram bot token from @BotFather
  "telegramBotToken": "123456:ABC-DEF...",

  // Your Telegram user ID (for authentication)
  "telegramUserId": 123456789,

  // Enable self-edit mode by default
  "selfEdit": false,

  // Default model for the orchestrator
  "defaultModel": "claude-sonnet-4.6",

  // Model tiers for squad agents (ranked preference lists)
  "modelTiers": {
    "high": ["claude-opus-4.7", "claude-opus-4.6"],
    "medium": ["claude-sonnet-4.6", "gpt-5.5", "claude-opus-4.5"],
    "low": ["claude-haiku-4.5", "gpt-5.4-mini"]
  }
}
```

All persistent data is stored under `~/.io/`:

| Path | Purpose |
| --- | --- |
| `~/.io/config.json` | User configuration |
| `~/.io/wiki/` | Knowledge base (markdown files) |
| `~/.io/io.db` | SQLite database (squads, tasks) |
| `~/.io/skills/` | Installed skills |

## 🧩 Skills System

Skills are modular extensions that add new tools and capabilities to IO. Each skill is a directory containing a `SKILL.md` manifest and tool definitions.

### Managing Skills

```bash
# Search the skills.sh registry
io skill search "github"

# Install from a git repo
io skill add https://github.com/user/my-skill.git

# List installed skills
io skill list

# Remove a skill
io skill remove my-skill
```

### Creating a Skill

A skill is a directory with a `SKILL.md` file that describes the skill and its tools. See the [Contributing Guide](CONTRIBUTING.md) for details on the skill format.

## 👥 Squad System

Squads are persistent project teams that IO manages. Each squad:

- Is associated with a specific project or domain
- Remembers decisions, context, and conversation history
- Can have multiple specialized agents working together
- Persists across sessions in the SQLite database

IO's orchestrator automatically creates and manages squads based on your conversations.

## 🏗️ Architecture

```
User → [TUI / Telegram / HTTP API]
                ↓
         Orchestrator (Copilot SDK)
          ↕           ↕
     Squad Manager   Wiki/Memory
          ↓
     Worker Agents
```

IO is built around the **Copilot SDK** which handles all LLM interactions, including tool calling and context management. The **Orchestrator** manages the primary conversation session with automatic context compaction for infinite-length sessions.

For complex tasks, the orchestrator delegates work to **Worker Agents** — short-lived agent sessions that execute specific tasks and report back.

The **Squad System** provides persistent project context, while the **Wiki** serves as a long-term knowledge base that spans all conversations.

## 🏗️ Project Structure

```
src/
├── index.ts              # CLI entry (commander)
├── daemon.ts             # Daemon startup/shutdown
├── config.ts             # Config loading
├── paths.ts              # Path constants
├── update.ts             # Self-update checker
├── copilot/
│   ├── client.ts         # CopilotClient singleton
│   ├── orchestrator.ts   # Main session management
│   ├── agents.ts         # Worker agent sessions
│   ├── tools.ts          # Tool definitions
│   ├── model-router.ts   # Complexity-based model selection
│   ├── skills.ts         # Skills loader
│   └── system-message.ts # System prompt builder
├── store/
│   ├── db.ts             # SQLite database
│   ├── squads.ts         # Squad CRUD
│   └── tasks.ts          # Agent task tracking
├── wiki/
│   ├── fs.ts             # Wiki filesystem
│   └── search.ts         # Wiki search
├── telegram/
│   ├── bot.ts            # Grammy Telegram bot
│   └── handlers.ts       # Command handlers
├── tui/
│   └── index.ts          # Terminal UI
└── api/
    └── server.ts         # Express HTTP + SSE
```

## 🛠️ Development

```bash
# Clone the repository
git clone https://github.com/michaeljolley/io.git
cd io

# Install dependencies
npm install

# Run in development mode (watch)
npm run dev

# Build for production
npm run build

# Run the TUI directly
npm run tui

# Run the daemon directly
npm run daemon
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed development guidelines.

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 🤝 Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting a pull request.
