# Getting Started

## Prerequisites

- Node.js 22+
- GitHub CLI (`gh`) — used for authentication with the Copilot SDK
- A GitHub account with Copilot access

## Installation

```bash
npm install -g heyio
```

## Initial Setup

Run the interactive setup wizard:

```bash
io setup
```

This will guide you through:

1. GitHub authentication (Copilot SDK handles this automatically via `gh` CLI)
2. Telegram bot token (optional)
3. Telegram authorized user ID (optional)

Configuration is saved to `~/.io/config.json`.

## Quick Start

Start the TUI (interactive chat):

```bash
io
```

Start as a background daemon:

```bash
io --daemon
```

## Configuration File

IO stores config at `~/.io/config.json`:

```jsonc
{
  "telegramBotToken": "123456:ABC-DEF...",
  "authorizedUserId": 123456789,
  "telegramEnabled": true,
  "defaultModel": "claude-sonnet-4.6",
  "port": 3170
}
```

The web frontend is available at `http://your-server:PORT/` (default: `http://localhost:3170/`).

## Running as a systemd Service (Linux)

Create `/etc/systemd/system/io.service`:

```ini
[Unit]
Description=IO AI Assistant Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=your-user
ExecStart=/usr/bin/env io --daemon
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then enable:

```bash
sudo systemctl enable --now io
```

## Next Steps

- [Configuration](./configuration.md) — Full config reference
- [Web Frontend](./web-frontend.md) — Web dashboard guide
- [Telegram Setup](./telegram.md) — Detailed Telegram integration guide
- [Skills](./skills.md) — Extend IO with custom skills
