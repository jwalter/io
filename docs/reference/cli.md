# CLI Reference

## Usage

```bash
io [OPTIONS] [COMMAND]
```

IO is built with [Commander](https://www.npmjs.com/package/commander) and provides a top-level command with several sub-commands.

## Global Options

| Flag             | Description                              |
| ---------------- | ---------------------------------------- |
| `--daemon`       | Run as a background daemon (no TUI)      |
| `--self-edit`    | Allow IO to modify its own source code   |
| `-h`, `--help`   | Print help information                   |
| `-V`, `--version`| Print the current package version        |

## Commands

### `io`

Launches IO in **interactive TUI mode** — a terminal chat interface. The TUI starts the database, wiki, orchestrator, and an internal API server, then opens the interactive prompt.

```bash
io
```

### `io --daemon`

Runs IO in **headless daemon mode** (no TUI). Use this for background operation or when IO should only be reachable through external interfaces (Telegram, API).

```bash
io --daemon
```

### `io setup`

Runs an **interactive configuration wizard** that prompts for:

- Telegram Bot Token
- Telegram User ID

Settings are saved to `~/.io/config.json`. Telegram is enabled automatically when both a bot token and user ID are provided.

```bash
io setup
```

### `io skill`

Manage installed Agent Skills.

#### `io skill list`

List all currently installed skills, showing each skill's name, slug, and description.

```bash
io skill list
```

#### `io skill search <query>`

Search the skills registry for available skills matching a query.

```bash
io skill search "pdf processing"
```

#### `io skill add <repo-url>`

Install a skill from a git repository URL.

```bash
io skill add https://github.com/example/my-skill
```

#### `io skill remove <slug>`

Remove an installed skill by its slug.

```bash
io skill remove my-skill
```

## Environment Variables

| Variable        | Description                                                          |
| --------------- | -------------------------------------------------------------------- |
| `GITHUB_TOKEN`  | GitHub token for Copilot SDK access (falls back to `gh auth token`)   |

## Examples

```bash
# Start interactive TUI
io

# Run as a background daemon
io --daemon

# Allow self-editing of IO source
io --self-edit

# Configure Telegram integration
io setup

# Search for and install a skill
io skill search "code review"
io skill add https://github.com/example/code-review-skill

# Check version
io --version
```
