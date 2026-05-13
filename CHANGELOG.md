# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-05-13

### Added

- **Scheduled stand-ups** (#45) — squads can be put on a recurring cron-style schedule via `squad_schedule_create` (and `_list`/`_pause`/`_resume`/`_delete`/`_run_now`). Built-in agenda items: `triage`, `prioritize`, `ideation`. Runs in the background daemon even when no human is in the TUI/Telegram.
- **Tiered human-readable activity log** (#47) — task event streams now carry a per-event `summary` and a new `GET /tasks/:id/activity` endpoint exposes a merged view. Web UI activity modal shows a clean summary by default with click-to-expand detail and a master "Show details" toggle. TUI gains `/activity [id|N]` and `/verbose` commands.
- **Active-agent model badge** (#38) — the web UI now shows the model an agent is using while it's working.
- **QA reviewer + test-engineer enforcement** (#41) — every squad must have a QA reviewer (`squad_set_qa`) and at least one role with a testing/quality focus. `squad_status`, `squad_agents`, and `squad_delegate` surface a ⚠️ warning when either is missing (warn, not block).

### Changed

- **Team lead carries implicit veto power** (#48) — the lead now blocks PR auto-promotion on rejection without needing to also be designated as QA. `squad_task_reviews` badges reviewers ⭐ lead / 🛡️ QA / ⭐🛡️ both and tags rejections from either as **veto**.

### Fixed

- **Robust APPROVED/REJECTED parsing in peer review** (#43) — verdict parsing now strips markdown, scans the first 10 non-empty lines for a line-leading verdict, and falls back to first occurrence anywhere. Fixes auto-promotion failing on reviews with blank leading lines, headers, or chatty preambles.

## [1.0.0] - 2026-05-08

### 🚀 Complete TypeScript Rewrite

IO has been completely rewritten from Rust to TypeScript, built on the GitHub Copilot SDK. This is a ground-up reimplementation with a new architecture, new dependencies, and new capabilities.

#### Added

- **Copilot SDK integration** for all LLM interactions, replacing the custom GitHub Models API client
- **Persistent orchestrator sessions** with automatic context compaction for infinite-length conversations
- **Squad system** for persistent project teams that remember decisions and context across sessions
- **Wiki-based knowledge base** at `~/.io/wiki/` for long-term memory
- **Telegram bot interface** powered by [grammy](https://grammy.dev/)
- **Terminal TUI interface** with readline-based input
- **HTTP API with SSE streaming** via Express for future web UI integration
- **Modular skill system** — install skills from git repos or the [skills.sh](https://skills.sh) registry
- **Worker agent system** for delegating complex tasks to specialized agent sessions
- **Self-update checker** to notify when new versions are available
- **Setup wizard** (`io setup`) for guided first-time configuration
- **CLI interface** with commander — `io`, `io --daemon`, `io skill` subcommands

#### Changed

- **Rewritten from Rust to TypeScript** — the entire codebase is now TypeScript with ESM modules
- **Replaced custom GitHub Models API client** with the official [Copilot SDK](https://www.npmjs.com/package/@github/copilot-sdk)
- **Replaced teloxide with grammy** for Telegram bot functionality
- **Replaced ratatui with readline** for the terminal UI
- **Replaced rusqlite with better-sqlite3** for SQLite database access
- **Replaced TOML config with JSON** — configuration now lives at `~/.io/config.json`

#### Removed

- **Direct GitHub Models API integration** — now handled entirely by the Copilot SDK
- **Custom retry/backoff logic** — handled by the Copilot SDK
- **Custom context window management** — replaced by the SDK's infinite sessions with automatic compaction
- **Model fallback chains** — the Copilot SDK manages model selection
- **Cost tracking** — no longer needed with the Copilot SDK
- **Cargo/Rust build system** — replaced by npm and TypeScript compiler
