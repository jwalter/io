# Auto-Update

io-daemon includes a built-in self-update system that checks for new releases on GitHub and can automatically apply them.

## How It Works

1. **Check**: The daemon queries the [GitHub Releases API](https://api.github.com/repos/michaeljolley/io/releases/latest) for the latest version
2. **Compare**: Current version (compiled into the binary) is compared against the latest release tag using [semver](https://semver.org/)
3. **Download**: If a newer version exists, the platform-appropriate archive is downloaded
4. **Verify**: SHA256 checksum of the downloaded archive is verified against `sha256sums.txt` from the release
5. **Replace**: The current binary is replaced with the new version
6. **Restart**: On systemd, the service automatically restarts with the new binary

## Schedule

- **On startup**: First check runs 5 seconds after the daemon starts
- **Periodic**: Subsequent checks run every `check_interval_hours` (default: 12 hours)

## Configuration

```toml
[update]
enabled = true              # Set to false to disable all update checks
check_interval_hours = 12   # Hours between checks
auto_apply = true           # Automatically install updates
```

### Disabling Updates

```toml
[update]
enabled = false
```

### Manual Updates Only

To be notified of updates without auto-installing:

```toml
[update]
auto_apply = false
```

The daemon will log when a new version is available but won't apply it automatically.

## Platform Detection

The updater detects the correct binary at compile time:

| OS      | Architecture | Archive                                       |
| ------- | ------------ | --------------------------------------------- |
| Linux   | x86_64       | `io-daemon-x86_64-unknown-linux-gnu.tar.gz`   |
| Windows | x86_64       | `io-daemon-x86_64-pc-windows-msvc.zip`        |
| macOS   | x86_64       | `io-daemon-x86_64-apple-darwin.tar.gz`        |
| macOS   | ARM64        | `io-daemon-aarch64-apple-darwin.tar.gz`       |

## Security

- Downloads only from `github.com/michaeljolley/io/releases`
- SHA256 checksums verified before applying
- Executable permissions set on Unix after extraction

## Systemd Integration

When running as a systemd service with `Restart=on-failure`, the update process works seamlessly:

1. Daemon downloads and verifies the new binary
2. Replaces `/usr/local/bin/io-daemon`
3. Exits with code 0
4. Systemd restarts the service with the new binary

```ini
[Service]
Restart=on-failure
RestartSec=5
```

::: tip
Use `Restart=on-failure` rather than `Restart=always` so the daemon can exit cleanly after an update and restart with the new binary.
:::
