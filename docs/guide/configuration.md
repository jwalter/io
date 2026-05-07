# Configuration

IO is configured via a TOML file at `~/.io/config.toml`. All sections are optional — the daemon uses sensible defaults when values are omitted.

## Full Reference

```toml
# Root directory for all daemon data (squads, wiki, database, logs)
data_dir = "~/.io"

# Model configuration
[models]
# Default model for agent sessions
default = "claude-sonnet-4-5"
# Fallback chain — if the primary model is unavailable, try the next
fallback_chain = ["claude-sonnet-4-5", "gpt-4.1"]

# Telegram bot configuration (optional)
[telegram]
# Bot token from @BotFather
bot_token = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
# Telegram usernames allowed to interact with the bot
allowed_users = ["yourusername"]

# Auto-update configuration
[update]
# Enable/disable update checking
enabled = true
# How often to check for updates (hours)
check_interval_hours = 12
# Automatically download and apply updates without prompting
auto_apply = true
```

## Sections

### `data_dir`

- **Type:** `string`
- **Default:** `~/.io`

The root directory where IO stores all persistent data including the SQLite database, squad configurations, wiki pages, and logs.

### `[models]`

Controls which AI models are used for agent sessions.

| Key              | Type       | Default              | Description                              |
| ---------------- | ---------- | -------------------- | ---------------------------------------- |
| `default`        | `string`   | `"claude-sonnet-4-5"` | Primary model for all agent sessions     |
| `fallback_chain` | `string[]` | `[]`                 | Ordered list of fallback models          |

The fallback chain is tried in order when the primary model is unavailable or rate-limited.

### `[telegram]`

Configures the Telegram bot interface. If this section is omitted, the Telegram interface is disabled.

| Key             | Type       | Default | Description                                  |
| --------------- | ---------- | ------- | -------------------------------------------- |
| `bot_token`     | `string`   | —       | Bot token from [@BotFather](https://t.me/botfather) |
| `allowed_users` | `string[]` | `[]`    | Usernames authorized to use the bot          |

::: warning
Always keep your bot token secret. Never commit it to version control.
:::

### `[update]`

Controls the self-update system.

| Key                    | Type   | Default | Description                                    |
| ---------------------- | ------ | ------- | ---------------------------------------------- |
| `enabled`              | `bool` | `true`  | Whether to check for updates                   |
| `check_interval_hours` | `u64`  | `12`    | Hours between update checks                    |
| `auto_apply`           | `bool` | `true`  | Automatically apply updates when found          |

When `auto_apply` is `true`, the daemon downloads, verifies (SHA256), and replaces itself automatically. When `false`, it logs a message about the available update.

## Data Directory Layout

```
~/.io/
├── config.toml              # Configuration file
├── daemon.db                # SQLite database (FTS5)
├── squads/
│   └── {project-slug}/
│       ├── squad.toml       # Squad metadata
│       ├── routing.md       # Pattern → agent routing rules
│       ├── decisions.md     # Decision log
│       └── agents/
│           └── {agent-name}/
│               ├── charter.md   # Agent identity and role
│               └── history.md   # Accumulated learnings
├── wiki/                    # Personal knowledge base
│   └── {topic}.md
└── logs/
    └── {date}.log
```

## Environment Variables

| Variable    | Description                          |
| ----------- | ------------------------------------ |
| `RUST_LOG`  | Logging level (`trace`, `debug`, `info`, `warn`, `error`) |
