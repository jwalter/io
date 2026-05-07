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
| `-d`, `--daemon`         | Run in daemon mode (default: true)               |
| `-h`, `--help`           | Print help information                           |
| `-V`, `--version`        | Print version                                    |

## Commands

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
