# Configuration

IO is configured via `~/.io/config.json` and environment variables. Environment variables take precedence over the config file.

## Config File

```json
{
  "port": 7777,
  "logLevel": "info",
  "defaultModel": "gpt-4.1",
  "telegramToken": "YOUR_BOT_TOKEN",
  "telegramUserId": "123456789",
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseAnonKey": "your-anon-key",
  "sessionResetThreshold": 50
}
```

All fields are optional — IO runs with sensible defaults if no config file exists.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `IO_PORT` | HTTP/WS server port | `7777` |
| `IO_LOG_LEVEL` | Log level (trace/debug/info/warn/error) | `info` |
| `IO_DEFAULT_MODEL` | Default LLM model | `gpt-4.1` |
| `IO_TELEGRAM_TOKEN` | Telegram bot token | — |
| `IO_TELEGRAM_USER_ID` | Allowed Telegram user ID | — |
| `IO_SUPABASE_URL` | Supabase project URL | — |
| `IO_SUPABASE_ANON_KEY` | Supabase anonymous key | — |
| `IO_SESSION_RESET_THRESHOLD` | Message count before session reset | `50` |

## Model Routing

IO uses smart model routing to balance cost and capability:

| Tier | Use Case | Default Model |
|------|----------|---------------|
| **Fast** | Simple questions, greetings, status checks | `gpt-4.1-mini` |
| **Standard** | Moderate tasks, code questions, planning | `claude-sonnet-4.6` |
| **Premium** | Complex analysis, architecture decisions | `claude-sonnet-4.6` |

The router classifies each incoming message and selects the appropriate tier automatically. The `defaultModel` config sets the fallback model used when the router cannot classify a message.

## Authentication

### Telegram

Authentication is by Telegram user ID. Set your numeric user ID in `telegramUserId` (config) or `IO_TELEGRAM_USER_ID` (env). Messages from other users are ignored.

### Web Dashboard

If Supabase is configured, the web dashboard requires login. Without Supabase config, the dashboard is open (suitable for local-only use).

## Data Directory

All IO data lives in `~/.io/`:

| Path | Purpose |
|------|---------|
| `config.json` | Configuration |
| `io.db` | libSQL database (squads, conversations, tokens, etc.) |
| `wiki/pages/` | Knowledge base markdown pages |
| `skills/` | Installed SKILL.md skill files |
| `logs/io.log` | Application logs (rotated) |
