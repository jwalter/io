# Getting Started

## Prerequisites

- Node.js 22+
- A GitHub account with Copilot access (the Copilot SDK handles auth via GitHub CLI or token)

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

```json
{
  "telegramBotToken": "your-bot-token",
  "authorizedUserId": 123456789,
  "telegramEnabled": true
}
```

## Running as a systemd Service (Linux)

Create `/etc/systemd/system/io.service`:

```ini
[Unit]
Description=IO AI Assistant Daemon
After=network.target

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
- [Telegram Setup](./telegram.md) — Detailed Telegram integration guide
- [Skills](./skills.md) — Extend IO with custom skills
