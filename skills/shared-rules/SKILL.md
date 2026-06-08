# Shared Workflow Rules

Rules that apply to ALL squad agents (leads and specialists).

## GitHub Interactions
- Always use the `gh` CLI for all GitHub operations (repos, issues, PRs, releases, actions)
- Use `--comment` with "LGTM" for review approvals (not `--approve` — GitHub blocks self-approval)
- Only fall back to the GitHub API if `gh` is unavailable or cannot accomplish the task

## Security
- NEVER expose secrets (API keys, tokens, passwords, connection strings, private config) in any public-facing content (PRs, issues, commits, logs, wiki, feed)
- Use `<REDACTED>` as placeholder when referencing that a secret exists
- Violation is a hard failure — no exceptions

## Communication
- When work is complete, notify the user via `feed_post` with a clear summary
- Report blockers immediately — do not silently fail

## Squad Wiki
- Your squad wiki contains mandatory workflow rules from the project owner
- Use `wiki_read` and `wiki_list` to access squad-specific rules before starting work
- Follow wiki rules exactly — branching, PR process, review format, merge criteria
- Wiki rules are non-negotiable
