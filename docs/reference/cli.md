# CLI Reference

## Usage

```bash
io [OPTIONS] [COMMAND]
```

## Options

| Flag                     | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `--config <PATH>`        | Path to config file (default: `~/.io/config.toml`) |
| `--log-level <LEVEL>`    | Log level (default: `info`)                      |
| `-d`, `--daemon`         | Run in headless daemon mode (no TUI)             |
| `-h`, `--help`           | Print help information                           |
| `-V`, `--version`        | Print version                                    |

## Commands

### `io` (no command)

Launches IO with the interactive TUI (terminal chat interface). The TUI runs alongside any configured interfaces (e.g., Telegram).

### `io chat`

Explicitly launches the interactive TUI. Same as running `io` without `--daemon`.

### `io --daemon`

Runs IO in headless mode (no TUI). Use this for systemd services or background operation.

### `io skill`

Manage installed Agent Skills.

```bash
io skill list                          # List installed skills
io skill search <query>                # Search skills.sh registry
io skill add <owner/repo@slug>         # Install a skill from skills.sh
io skill remove <name>                 # Remove an installed skill
```

**Examples:**

```bash
# Search for PDF-related skills
io skill search "pdf processing"

# Install a skill
io skill add anthropics/skills@pdf

# List all installed skills
io skill list

# Remove a skill
io skill remove pdf
```

## Environment Variables

| Variable        | Description                                          |
| --------------- | ---------------------------------------------------- |
| `GITHUB_TOKEN`  | GitHub token for Models API access (preferred over `gh auth token`) |
| `RUST_LOG`      | Set log level (`trace`, `debug`, `info`, `warn`, `error`) |
| `IO_CONFIG`    | Override config file path                            |
| `IO_DATA_DIR`  | Override data directory                              |

## Examples

```bash
# Run with default settings
io

# Run with custom config
io --config /etc/io/config.toml

# Run with debug logging
RUST_LOG=debug io

# Check version
io --version
```

## Exit Codes

| Code | Meaning                           |
| ---- | --------------------------------- |
| `0`  | Clean shutdown or successful update |
| `1`  | Configuration error               |
| `2`  | Runtime error                     |
