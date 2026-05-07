# Getting Started

## Prerequisites

- A [GitHub Copilot](https://github.com/features/copilot) subscription
- GitHub CLI authenticated (`gh auth login`)

## Installation

### GitHub Releases (Recommended)

Download the latest prebuilt binary from [Releases](https://github.com/michaeljolley/io/releases):

| Platform       | Target                       |
| -------------- | ---------------------------- |
| Linux x86_64   | `x86_64-unknown-linux-gnu`   |
| Windows x86_64 | `x86_64-pc-windows-msvc`     |
| macOS x86_64   | `x86_64-apple-darwin`        |
| macOS ARM64    | `aarch64-apple-darwin`       |

```bash
# Example: Linux x86_64
curl -sL https://github.com/michaeljolley/io/releases/latest/download/io-x86_64-unknown-linux-gnu.tar.gz \
  | tar xz
chmod +x io
mv io /usr/local/bin/
```

### Cargo Install

```bash
cargo install --git https://github.com/michaeljolley/io.git
```

### Building from Source

```bash
git clone https://github.com/michaeljolley/io.git
cd io
cargo build --release
```

#### Feature Flags

| Flag          | Default | Description                       |
| ------------- | ------- | --------------------------------- |
| `tui`         | ✅      | Terminal UI via ratatui            |
| `telegram`    | ✅      | Telegram bot via teloxide          |
| `web`         | —       | Future Vue 3 web frontend         |
| `copilot-sdk` | —       | Use real GitHub Copilot SDK crate  |

Build with specific features:

```bash
# TUI only
cargo build --release --no-default-features --features tui

# All features
cargo build --release --all-features
```

## Configuration

Create a config file at `~/.io/config.toml`:

```toml
data_dir = "~/.io"

[models]
default = "claude-sonnet-4-5"
fallback_chain = ["claude-sonnet-4-5", "gpt-4.1"]

[telegram]
bot_token = "YOUR_BOT_TOKEN"
allowed_users = ["yourusername"]

[update]
enabled = true
check_interval_hours = 12
auto_apply = true
```

See the [Configuration Reference](/guide/configuration) for all options.

## Running

```bash
io
```

The daemon will:

1. Load configuration from `~/.io/config.toml`
2. Initialize the SQLite database
3. Start the event bus
4. Launch the orchestrator bridge
5. Start enabled interfaces (TUI, Telegram)
6. Begin checking for updates

## Running as a Systemd Service

For always-on operation on Linux:

```bash
cat > /etc/systemd/system/io.service << 'EOF'
[Unit]
Description=IO personal AI assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/io
Restart=on-failure
RestartSec=5
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now io
```

Check status:

```bash
systemctl status io
journalctl -u io -f
```
