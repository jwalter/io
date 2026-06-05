# Configuration Reference

Complete reference for all configuration options in `~/.io/config.json`.

## Full Schema

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

All fields are optional. IO runs with sensible defaults if omitted.

## Fields

### `port`
- **Type:** `number`
- **Default:** `7777`
- **Env:** `IO_PORT`
- **Description:** HTTP and WebSocket server port

### `logLevel`
- **Type:** `"trace" | "debug" | "info" | "warn" | "error"`
- **Default:** `"info"`
- **Env:** `IO_LOG_LEVEL`
- **Description:** Minimum log level for output

### `defaultModel`
- **Type:** `string`
- **Default:** `"gpt-4.1"`
- **Env:** `IO_DEFAULT_MODEL`
- **Description:** Fallback LLM model used when the router cannot classify a message

### `telegramToken`
- **Type:** `string | null`
- **Default:** `null`
- **Env:** `IO_TELEGRAM_TOKEN`
- **Description:** Bot token from @BotFather. Required for Telegram integration.

### `telegramUserId`
- **Type:** `string | null`
- **Default:** `null`
- **Env:** `IO_TELEGRAM_USER_ID`
- **Description:** Telegram user ID allowed to interact with the bot. Messages from other users are ignored.

### `supabaseUrl`
- **Type:** `string | null`
- **Default:** `null`
- **Env:** `IO_SUPABASE_URL`
- **Description:** Supabase project URL. Required for web dashboard authentication.

### `supabaseAnonKey`
- **Type:** `string | null`
- **Default:** `null`
- **Env:** `IO_SUPABASE_ANON_KEY`
- **Description:** Supabase anonymous/public key. Required for web dashboard authentication.

### `sessionResetThreshold`
- **Type:** `number`
- **Default:** `50`
- **Env:** `IO_SESSION_RESET_THRESHOLD`
- **Description:** Number of messages before the conversation context window resets

## Model Routing

IO uses smart model routing with three tiers. The tier models are currently set by built-in constants:

| Tier | Default Model | Use Case |
|------|---------------|----------|
| **Fast** | `gpt-4.1-mini` | Simple questions, greetings, status checks |
| **Standard** | `claude-sonnet-4.6` | Moderate tasks, code questions, planning |
| **Premium** | `claude-sonnet-4.6` | Complex analysis, architecture decisions |

The `defaultModel` config field sets the fallback model when the router cannot classify a message into a tier.

## Validation

Configuration is validated at startup using Zod. Invalid config will cause a startup error with a descriptive message indicating which field is invalid.

## Environment Variable Precedence

Environment variables always override `config.json` values. This makes it easy to configure IO differently in production vs development without modifying the config file.
