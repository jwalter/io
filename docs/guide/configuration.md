# Configuration

IO is configured via a JSON file at `~/.io/config.json`. All fields are optional — IO uses sensible defaults when values are omitted.

## Config File Location

`~/.io/config.json` — created automatically by `io setup`, or you can create it manually.

## Reference

```json
{
  "telegramBotToken": "bot-token-from-botfather",
  "authorizedUserId": 123456789,
  "telegramEnabled": true,
  "selfEditEnabled": false,
  "defaultModel": "openai/gpt-4.1",
  "apiPort": 3170
}
```

| Field              | Type      | Default | Description                                                        |
| ------------------ | --------- | ------- | ------------------------------------------------------------------ |
| `telegramBotToken` | `string`  | —       | Bot token from [@BotFather](https://t.me/botfather)                |
| `authorizedUserId` | `number`  | —       | Telegram user ID authorized to interact with the bot               |
| `telegramEnabled`  | `boolean` | `false` | Enable the Telegram bot interface                                  |
| `selfEditEnabled`  | `boolean` | `false` | Allow IO to modify its own configuration and skills at runtime     |
| `defaultModel`     | `string`  | —       | Override the default model (e.g. `"openai/gpt-4.1"`)              |
| `apiPort`          | `number`  | `3170`  | Port for the local API server                                      |

::: warning
Always keep your bot token secret. Never commit `config.json` to version control.
:::

## Model Selection

The Copilot SDK handles model selection automatically — the orchestrator chooses the best model for each operation. You can override the default with the `defaultModel` field, but in most cases no manual model configuration is needed.

## Data Directory

IO stores all persistent data in `~/.io/`:

```
~/.io/
├── config.json          # Configuration
├── io.db                # SQLite database (squads, decisions, state)
├── wiki/                # Knowledge wiki (markdown files)
├── skills/              # Installed skills (SKILL.md files)
├── sessions/            # Session data
└── logs/                # Log files
```

## Environment Variables

| Variable   | Description                                                  |
| ---------- | ------------------------------------------------------------ |
| `IO_HOME`  | Override the data directory (default: `~/.io/`)              |
| `NODE_ENV` | Standard Node.js environment (`development`, `production`)   |
