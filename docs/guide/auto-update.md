# Auto-Update

IO automatically keeps itself up to date via npm. Every time the daemon starts, it checks for a newer version and installs it — no configuration or manual intervention required.

## How It Works

1. **Check** — On startup, the daemon runs `npm view heyio version` to fetch the latest published version from the npm registry
2. **Compare** — The result is compared against the version in the running `package.json` using semver
3. **Install** — If a newer version exists, `npm install -g heyio@latest` is executed automatically
4. **Re-exec** — After a successful install, the daemon spawns a new process with the updated code and exits the old one so the new version takes over immediately

The entire flow happens before the daemon begins normal operation, so you are always running the latest release.

## No Configuration Needed

Auto-update is always on. There are no flags to toggle or intervals to set — the check runs once at startup and either updates or continues with the current version.

If the npm registry is unreachable or the install fails for any reason, the daemon logs a warning and continues running the current version normally.

## Manual Update

You can update at any time by running:

```bash
npm install -g heyio@latest
```

Then restart the daemon to pick up the new version.

## How Re-exec Works

When an update is installed, the daemon re-launches itself so the new code is loaded without requiring a separate restart:

1. A new detached child process is spawned using the same Node executable and arguments
2. The environment variable `IO_RESTARTED=1` is set on the child so it can detect a post-update restart
3. The child is `unref()`'d so it is not tied to the parent
4. The original process exits with code 0

This means the transition is seamless — the new version picks up exactly where the old one would have started.
