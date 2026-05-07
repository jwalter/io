# CLI Reference

## Usage

```bash
io-daemon [OPTIONS]
```

## Options

| Flag                     | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `--config <PATH>`        | Path to config file (default: `~/.io-daemon/config.toml`) |
| `--data-dir <PATH>`      | Override data directory                          |
| `--no-update`            | Disable update checking for this run              |
| `-v`, `--verbose`        | Increase log verbosity                           |
| `-q`, `--quiet`          | Suppress non-error output                        |
| `-h`, `--help`           | Print help information                           |
| `-V`, `--version`        | Print version                                    |

## Environment Variables

| Variable       | Description                                          |
| -------------- | ---------------------------------------------------- |
| `RUST_LOG`     | Set log level (`trace`, `debug`, `info`, `warn`, `error`) |
| `IO_CONFIG`    | Override config file path                            |
| `IO_DATA_DIR`  | Override data directory                              |

## Examples

```bash
# Run with default settings
io-daemon

# Run with custom config
io-daemon --config /etc/io-daemon/config.toml

# Run with debug logging
RUST_LOG=debug io-daemon

# Run without update checks
io-daemon --no-update

# Check version
io-daemon --version
```

## Exit Codes

| Code | Meaning                           |
| ---- | --------------------------------- |
| `0`  | Clean shutdown or successful update |
| `1`  | Configuration error               |
| `2`  | Runtime error                     |
