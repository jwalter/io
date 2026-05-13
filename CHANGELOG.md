# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Install skills from the web UI** (#21) — the Skills tab now has an "Add Skill" form. Enter a git repository URL and click **Install** to install a skill without leaving the browser (mirrors the existing `skill_install` tool / TUI / Telegram path). The skills list refreshes after a successful install; validation and install errors are surfaced inline. Backed by a new `POST /api/skills` endpoint (auth-protected) that reuses `installSkill(repoUrl)` from `src/copilot/skills.ts`.


### Changed

- **Lead briefing + fan-out enforcement** (#51) — the team-lead system message now mandates a fan-out plan (work-area breakdown + charter-keyed teammate scoring + per-area subtask) before the lead may touch shell, files, or self-implement. Direct lead implementation is restricted to trivial single-file changes that fit no teammate's charter.
- **Soft delegation-budget warning** (#51) — `squad_status` now shows a per-agent work-distribution breakdown for the last 20 tasks and surfaces a ⚠️ "Lead overload" warning when the lead handled more than 80% of recent work.
- **Sub-delegations are tracked as first-class tasks** (#51) — `delegate_to_teammate` now records each subtask in `agent_tasks` (`origin_channel='delegate_to_teammate'`), so the work-distribution stat reflects real fan-out instead of misreporting that the lead did 100% of the work.
- **Increased `delegate_to_teammate` timeout** (#51) — bumped the per-call idle timeout from 5 minutes to 30 minutes so specialists have room to read, edit, and run tests without the lead giving up and self-implementing.
- **Dedicated team lead enforcement** (#71) — squad creation guidance now requires the team lead to be a PM / Senior Engineer with **no domain responsibility** (their sole job is coordinating, delegating, and reviewing). `squad_status`, `squad_agents`, and `squad_delegate` now surface a ⚠️ coverage warning when no lead is designated *or* when the lead's role title looks like a domain specialist (e.g. "Frontend Lead", "Test Manager"). `squad_set_lead` echoes the same warning at designation time. The team lead's automatic veto power on PR promotion (added in #48) is now documented alongside QA veto power as first-class — any QA reviewer, test engineer (when designated as QA), or the team lead can block a draft PR from being promoted to ready.
- **IO squad held to its own QA/test rule** (#52) — the system-message Squad Build Checklist now explicitly states that the squad owning the IO codebase (`michaeljolley-io`) gets no exemption from the QA-reviewer + test-engineer coverage rule, and the test-engineer charter must own the project's test suite (for IO: `src/**/*.test.ts` plus `npm run build` / `vue-tsc` on every PR). Verified the live squad already satisfies coverage (WilyKit's successor "WilyKat — TypeScript & Integration Test Engineer" carries `is_qa=1`).
- **Idle-reset timeout for agent tasks** (#53) — replaced the wall-clock `sendAndWait(prompt, 600_000)` calls in agent execution with a new `sendWithIdleTimeout` helper (`src/copilot/session-timeout.ts`). The timer resets on every progress event (tool execution, assistant message, turn boundary) and only fires when the agent goes genuinely silent. Main delegation: 10-minute idle window, 60-minute hard cap. Sub-delegation (`delegate_to_teammate`): 10-minute idle, 30-minute hard cap. The previous fixed 600s cap was killing two of three failed tasks in squad history mid-progress.
- **Graceful task timeout** (#53) — when the idle or hard-cap timer fires, the SDK session is aborted, the accumulated streaming content is captured, a new `task.timeout` event is emitted with `{reason, lastEventType, partial}`, and the task result is stored with a `[task timed out — ...]` prefix instead of dropping the work entirely. `delegate_to_teammate` returns the same stamped partial to the lead so it can decide whether to retry or accept.
- **Task idempotency / dedup** (#53) — `delegateToAgent` now detects when an identical task description is already running on the same `agent_slug` and returns the existing task ID instead of racing a second agent (recorded via a `task.dedup_joined` event on the original task).
- **Decisions surfaced on every delegation + post-task nudge** (#54) — the live agent task prompt is now wrapped in an envelope that (a) prepends the last 5 `squad_decisions` for context and (b) appends a tail asking the agent to call `squad_log_decision` if their work involved a non-trivial architectural choice. Applies to both the orchestrator's main delegation path and the lead's `delegate_to_teammate` sub-delegations. The original task description is still stored verbatim in `agent_tasks.description` — only the LLM prompt is enveloped.
- **`squad_status` shows recent decisions** (#54) — squad status output now includes a `📜 Recent decisions:` line with the last 3 entries (or a callout when the log is empty), so users can spot when a squad has stopped capturing institutional knowledge.

### Added

- **`squad_reset_agent` tool** (#56) — clears an agent's error state and returns them to `idle` without removing them. Preserves charter, role title, character name, and `is_lead`/`is_qa` flags. Drops the in-memory cached `CopilotSession` (and model) plus the persisted `copilot_session_id` so the next task creates a fresh session instead of trying to resume a poisoned one. Safe to call on a non-error agent (no-op with a clear message). Wired through `ToolDeps.resetSquadAgent` (orchestrator) → new `clearAgentSession` in `src/store/squads.ts` + new `clearAgentInMemorySession` in `src/copilot/agents.ts`. Documented in `docs/reference/tools.md`.

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
