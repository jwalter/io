# Knowledge System

IO's knowledge system provides long-term memory across sessions, agents, and squads through a filesystem-based markdown wiki.

## Wiki

A personal knowledge base stored as plain markdown files at `~/.io/wiki/`:

```
~/.io/wiki/
├── index.md                  # Auto-maintained index of all pages
├── log.md                    # Append-only operation log
├── pages/
│   ├── preferences/
│   │   └── editor.md
│   ├── projects/
│   │   └── my-web-app.md
│   ├── people/
│   │   └── teammates.md
│   └── general/
│       └── rust-patterns.md
└── sources/
    └── raw-meeting-notes.txt
```

### Topics and File Paths

Topics map directly to file paths under `pages/`. For example:

- `"preferences/editor"` → `~/.io/wiki/pages/preferences/editor.md`
- `"projects/my-web-app"` → `~/.io/wiki/pages/projects/my-web-app.md`

Default page categories: `preferences`, `projects`, `people`, `general`.

### Content Format

Pages are plain markdown — no YAML frontmatter. Tags and metadata are expressed in the markdown content itself:

```markdown
# Rust Patterns

Tags: rust, programming, patterns

## Error Handling
Use `thiserror` for library errors and `anyhow` for application errors...
```

### Atomic Writes

All writes use an atomic write-then-rename pattern to prevent corruption:

1. Write content to a temporary file in the same directory
2. `fsync` the file descriptor
3. Rename the temp file to the target path

This ensures pages are never left in a partial state.

## Operations

The wiki supports four core operations:

| Operation | Description |
| --------- | ----------- |
| **read** | Read a page by its relative path |
| **write** | Write/overwrite a page (must be under `pages/`, must end in `.md`) |
| **list** | List all `.md` pages under `pages/` |
| **search** | Search across all page contents by substring match |

### Path Safety

All paths are validated to prevent directory traversal — resolved paths must stay within the wiki directory.

## Search

Search uses simple case-insensitive string matching across all page contents. For each match, a contextual snippet (±100 characters around the match) is returned along with the page path and title.

```typescript
searchWiki("error handling")
// → [{ path: "pages/general/rust-patterns.md",
//       title: "Rust Patterns",
//       snippet: "…Use thiserror for library errors…" }]
```

Titles are extracted from the first markdown heading in each page, falling back to the filename.

## Raw Sources

The `sources/` directory stores raw, unstructured content (meeting notes, paste dumps, etc.) that hasn't been organized into wiki pages. Source filenames are sanitized to alphanumeric characters, dots, hyphens, and underscores.

## Cross-Squad Sharing

The wiki is shared across all squads — any agent can read and write wiki pages through the wiki tool, enabling learnings from one project to benefit others.

## Key Source Files

| File | Purpose |
| --- | --- |
| `src/wiki/fs.ts` | Filesystem operations: read, write, list, atomic writes, path validation |
| `src/wiki/search.ts` | Substring search across wiki pages, summary generation |
