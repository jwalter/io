# Knowledge System

IO's knowledge system provides long-term memory across sessions, agents, and squads. It combines structured search (SQLite FTS5) with human-readable storage (markdown wiki).

## Components

### SQLite FTS5 Index

The daemon maintains a full-text search index over:

- **Message history**: All user and agent messages
- **Wiki pages**: Personal knowledge base entries
- **Agent histories**: Accumulated project learnings
- **Decision logs**: Recorded squad decisions

This enables fast, relevance-ranked search across all knowledge.

### Markdown Wiki

A personal knowledge base stored at `~/.io/wiki/`:

```
~/.io/wiki/
├── rust-patterns.md
├── docker-cheatsheet.md
├── meeting-notes-2025.md
└── project-ideas.md
```

Wiki pages support YAML frontmatter for metadata:

```markdown
---
title: Rust Patterns
tags: [rust, programming, patterns]
created: 2025-05-01
updated: 2025-05-06
---

# Rust Patterns

## Error Handling
Use `thiserror` for library errors and `anyhow` for application errors...
```

### Agent Memory

Each agent accumulates project-specific learnings in `history.md`:

```markdown
## Project Learnings

- Uses React 18 with TypeScript strict mode
- State management via Zustand (not Redux)
- API follows REST conventions with /api/v2 prefix
- Tests use Vitest + React Testing Library
```

This context is injected into agent sessions, enabling them to make informed decisions without re-discovering project patterns.

## Knowledge Flow

```
User Message
     │
     ▼
Search FTS5 Index → Relevant context
     │
     ▼
Inject into Agent Session
     │
     ▼
Agent Response
     │
     ▼
Store in FTS5 Index (for future searches)
```

## Wiki Commands

Through the Telegram bot or TUI:

| Command               | Description                        |
| --------------------- | ---------------------------------- |
| `/wiki search <query>` | Search the knowledge base          |
| `/wiki list`           | List all wiki pages                |
| `/wiki read <topic>`   | Read a specific page               |

Agents can also read and write wiki pages through the wiki tool, enabling them to persist learnings that span sessions.

## Cross-Squad Sharing

Knowledge sharing happens at two levels:

1. **Wiki**: Shared across all squads — any agent can read/write wiki pages
2. **Agent history**: Squad-specific — stays with the agent and its project

This means general knowledge (language best practices, deployment patterns) flows freely, while project-specific context (architecture decisions, codebase patterns) stays scoped.

## Search

All search is powered by SQLite FTS5, which supports:

- Ranked relevance scoring
- Phrase matching
- Boolean operators (AND, OR, NOT)
- Prefix matching

```sql
SELECT * FROM knowledge WHERE knowledge MATCH 'rust AND error handling'
ORDER BY rank;
```
