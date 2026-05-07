# Getting Started

## Prerequisites

- A GitHub account with access to [GitHub Models](https://github.com/marketplace/models)
- A `GITHUB_TOKEN` with Models API access (or GitHub CLI authenticated via `gh auth login`)

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
default = "openai/gpt-4.1"
fallback_chain = ["openai/gpt-4.1", "openai/gpt-4o-mini"]

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

### Interactive Mode (TUI)

```bash
io
```

This launches the terminal chat interface where you can type messages and see IO's responses in real-time. The TUI shows a status bar, chat area with streaming responses, and an input prompt.

### Headless Daemon Mode

```bash
io --daemon
```

Runs IO without the TUI — useful for systemd services or background operation. Interaction happens through configured interfaces like Telegram.

In both modes, IO will:

1. Load configuration from `~/.io/config.toml`
2. Initialize the SQLite database
3. Start the event bus
4. Launch the orchestrator bridge
5. Scan for installed skills
6. Start enabled interfaces (Telegram, etc.)
7. Begin checking for updates

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
ExecStart=/usr/local/bin/io --daemon
Restart=on-failure
RestartSec=5
Environment=RUST_LOG=info
Environment=GITHUB_TOKEN=ghp_your_token_here

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
