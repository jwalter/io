# Contributing to io-daemon

Thank you for your interest in contributing to io-daemon — a personal AI
assistant daemon powered by the GitHub Copilot SDK, written in Rust! This guide
will help you get started.

## Code of Conduct

Please be respectful and constructive in all interactions. We're all here to
build something great together.

## Getting Started

### Prerequisites

- [Rust stable toolchain](https://rustup.rs/) (install via `rustup`)
- Any OS — Linux, macOS, or Windows

### Building

```bash
cargo build --release
```

For a full build with all optional features enabled:

```bash
cargo build --release --all-features
```

### Running Tests

```bash
cargo test --all-features
```

### Linting

```bash
cargo clippy --all-features -- -D warnings
```

### Formatting

```bash
cargo fmt --check
```

To auto-fix formatting:

```bash
cargo fmt
```

## Project Structure

A brief overview of the `src/` layout:

| Path | Description |
|------|-------------|
| `main.rs` | Application entry point |
| `config.rs` | Configuration loading and management |
| `orchestrator/` | Request orchestration and agent coordination |
| `squad/` | Dynamic multi-agent squad architecture |
| `routing.rs` | Request routing logic |
| `models/` | Data models and types |
| `tools/` | Tool integrations available to agents |
| `interfaces/` | External interface adapters |
| `db.rs` | Database access layer |
| `memory.rs` | Memory and context management |
| `copilot.rs` | GitHub Copilot SDK integration |
| `event_bus.rs` | Internal event bus for pub/sub messaging |
| `session_pool.rs` | Session pooling and lifecycle management |
| `cost.rs` | Token and cost tracking |
| `fallback.rs` | Fallback and retry strategies |
| `knowledge_sharing.rs` | Cross-agent knowledge sharing |
| `updater.rs` | Self-update mechanism |
| `shutdown.rs` | Graceful shutdown handling |

## How to Contribute

### Reporting Bugs

- Search [existing issues](https://github.com/michaeljolley/io/issues) before
  opening a new one
- Include steps to reproduce, expected behavior, and actual behavior
- Logs and backtraces are very helpful for diagnosing issues

### Suggesting Features

Open an [issue](https://github.com/michaeljolley/io/issues) describing the
feature, why it would be useful, and any implementation ideas you have.

### Submitting Changes

1. Fork the repository
2. Create a feature branch from `main` (`git checkout -b feature/my-change`)
3. Make your changes
4. Ensure the project builds, tests pass, and clippy/fmt are clean
5. Commit using conventional commits
6. Push to your fork and open a pull request against `main`

### Commit Messages

This project uses Conventional Commits. Please format your commit messages as:

```
type: short description

Optional longer description.
```

Common types:

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `ci` | CI/CD changes |
| `chore` | Maintenance tasks |
| `refactor` | Code changes that don't fix a bug or add a feature |
| `test` | Adding or updating tests |

### Pull Requests

- Keep PRs focused — one logical change per PR
- Ensure CI passes (build + tests + clippy + fmt run automatically)
- Provide a clear description of what changed and why
- Link any related issues (e.g., "Fixes #123")

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.
