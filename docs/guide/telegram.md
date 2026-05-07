# Telegram Bot

IO includes a Telegram bot interface powered by [teloxide](https://github.com/teloxide/teloxide), giving you mobile access to your AI assistant.

## Setup

### 1. Create a Bot with BotFather

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Choose a display name (e.g., "IO Assistant")
4. Choose a username (must end in `bot`, e.g., `io_assistant_bot`)
5. BotFather will give you a **bot token** — save this

### 2. Configure IO

Add the Telegram section to `~/.io/config.toml`:

```toml
[telegram]
bot_token = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
allowed_users = ["your_telegram_username"]
```

::: warning
Keep your bot token secret. If compromised, use `/revoke` with BotFather to generate a new one.
:::

### 3. Restart the Daemon

```bash
systemctl restart io
```

You should see in the logs:

```
INFO io_daemon: Telegram bot started
```

## Usage

Send any message to your bot and it will be routed through the orchestrator to the appropriate squad.

### Available Commands

| Command   | Description                                    |
| --------- | ---------------------------------------------- |
| `/start`  | Welcome message and bot introduction           |
| `/help`   | List available commands                        |
| `/squad`  | Show current squad composition and status      |
| `/wiki`   | Search or browse the knowledge wiki            |

### Text Messages

Any non-command message is treated as a chat message and routed to the orchestrator. The orchestrator determines which squad and agent(s) should handle the request.

### Long Responses

Telegram has a 4096-character message limit. IO automatically splits long responses into multiple messages while preserving formatting.

## Authentication

Only usernames listed in `allowed_users` can interact with the bot. Messages from unlisted users are silently ignored. This prevents unauthorized access to your AI assistant.

```toml
[telegram]
allowed_users = ["alice", "bob"]
```

## Without Telegram

If no `[telegram]` section is present in the config (or no `bot_token` is set), the daemon starts normally without the Telegram interface. No errors are produced — Telegram is fully optional.
