# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Lead briefing + fan-out enforcement** (#51) — the team-lead system message now mandates a fan-out plan (work-area breakdown + charter-keyed teammate scoring + per-area subtask) before the lead may touch shell, files, or self-implement. Direct lead implementation is restricted to trivial single-file changes that fit no teammate's charter.
- **Soft delegation-budget warning** (#51) — `squad_status` now shows a per-agent work-distribution breakdown for the last 20 tasks and surfaces a ⚠️ "Lead overload" warning when the lead handled more than 80% of recent work.
- **Sub-delegations are tracked as first-class tasks** (#51) — `delegate_to_teammate` now records each subtask in `agent_tasks` (`origin_channel='delegate_to_teammate'`), so the work-distribution stat reflects real fan-out instead of misreporting that the lead did 100% of the work.
- **Increased `delegate_to_teammate` timeout** (#51) — bumped the per-call idle timeout from 5 minutes to 30 minutes so specialists have room to read, edit, and run tests without the lead giving up and self-implementing.

## [0.4.0] - 2026-05-13

### Added

- **IO-level scheduler** (#59) — schedule recurring tasks for IO itself, no squad required. New `schedule_create`/`_list`/`_pause`/`_resume`/`_delete`/`_run_now` tools mirror the squad scheduler. Background daemon dispatches at the configured cron time even when no human is connected. Manual `run_now` preserves `last_run_at`/`next_run_at` so testing a schedule never disturbs its regular cadence (the same fix was applied to `squad_schedule_run_now`).

### Fixed

- **Agent error-state recovery** (#57, closes #50 #55) — `getOrCreateAgentSession` now re-reads the agent row and drops the cached Copilot session when the persisted status is `error`, so agents recover on the next task instead of being permanently stuck. Daemon startup runs `reconcileAgentStatuses` and `reconcileSquadStatuses` to clear stale rows from a crashed previous run.
- **Backfill misparsed peer-review verdicts** (#57) — surgical, idempotent backfill on daemon startup flips review rows where the comment unambiguously starts with `APPROVED` but the recorded verdict was `REJECTED`. Only ever flips `0 → 1`, never the reverse.

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
