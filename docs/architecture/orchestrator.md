# Orchestrator

The orchestrator is the brain of IO. It receives every user message and decides whether to **respond directly** or **delegate to a specialist squad**.

## Design Philosophy

IO uses a **hybrid approach**: the orchestrator handles simple, conversational messages itself (greetings, general knowledge, explanations) and delegates complex, project-specific work to agent squads. This gives you a natural conversational experience while still leveraging specialist agents for deep work.

- **Direct responses**: Greetings, general knowledge, simple explanations, status queries
- **Squad delegation**: Code generation, project-specific tasks, file operations, multi-step workflows
- **Composability**: Squads can be dynamically assembled for any project
- **Observability**: All routing decisions are logged and auditable

## CopilotSession

The orchestrator runs as a persistent `CopilotSession` via the [Copilot SDK](https://github.com/github/copilot-sdk). At startup, `initOrchestrator(copilotClient)` receives a connected `CopilotClient` and either resumes a saved session or creates a new one:

```
initOrchestrator(client)
       │
       ▼
 Saved session ID in SQLite?
 ┌──yes──┴──no──┐
 ▼              ▼
resumeSession  createSession
 │              │
 └──────┬───────┘
        ▼
  Session ready
```

The session ID is persisted in the SQLite state KV store under the key `orchestrator_session_id`. On restart, IO calls `client.resumeSession(savedId, config)` to pick up where it left off. If the resume fails (expired, not found), the saved ID is deleted and a fresh session is created.

## Infinite Sessions

The session is configured with `infiniteSessions` to prevent context exhaustion during long-running conversations:

```typescript
infiniteSessions: {
  enabled: true,
  backgroundCompactionThreshold: 0.80,
  bufferExhaustionThreshold: 0.95,
}
```

- **Background compaction (80%)**: When the context window is 80% full, the SDK begins compacting older messages in the background — summarising them to free space without interrupting the current exchange.
- **Buffer exhaustion (95%)**: If the context reaches 95% before compaction finishes, the SDK blocks and compacts synchronously to prevent token-limit errors.

This lets IO run indefinitely without losing the thread of conversation.

## Message Queue

Messages from all interfaces (Telegram, TUI, background tasks) are queued and processed **sequentially**. This guarantees the LLM sees a coherent conversation history — no interleaved requests.

```
Telegram ──┐
TUI ───────┤──→ messageQueue[] ──→ processQueue() ──→ executeOnSession()
Background ┘         (FIFO)         (one at a time)
```

Each message is tagged with its source (e.g. `[via telegram]`, `[via tui]`) so the orchestrator can adapt its response style. Both the user prompt and the assistant response are logged to the conversation store.

## System Message

The orchestrator's persona is defined by a dynamic system message built at session creation. It is assembled from:

1. **Base persona** — IO's identity, role, and behavioural guidelines
2. **Active skills** — Skill directories are passed via `skillDirectories` in the session config
3. **Squad roster** — Currently active squads and their status
4. **Memory summary** — A snapshot of the wiki knowledge base
5. **Self-edit policy** — Whether IO is allowed to modify its own source code

The system message also tells the LLM which channel each message came from and how to adapt (brief on Telegram, detailed in the TUI).

## How Routing Works

```
User message arrives
       │
       ▼
  LLM decides (via tool calls)
  ┌─────┴─────┐
  │ Text      │ Tool calls
  ▼           ▼
Respond    Delegate to
directly   squad agents
```

The LLM itself makes this decision naturally — it either responds with text (direct) or calls squad management tools (delegation). The orchestrator maintains conversation history across the session, enabling multi-turn interactions.

## Tool Execution

Tools are registered with the Copilot SDK's `defineTool()` API, each with a Zod schema for parameter validation. All tool calls are auto-approved via `onPermissionRequest: approveAll` — no human-in-the-loop confirmation.

The orchestrator registers these tools:

| Tool                | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `wiki_read`         | Read a page from the knowledge base                      |
| `wiki_write`        | Write or update a knowledge base page                    |
| `wiki_search`       | Search the knowledge base                                |
| `squad_create`      | Create a new project squad                               |
| `squad_recall`      | Recall a squad's context and decisions                   |
| `squad_status`      | List all squads and their status                         |
| `squad_log_decision`| Log a decision for a squad                               |
| `shell`             | Run a shell command on the host machine                  |
| `web_fetch`         | Fetch a URL and return its content                       |
| `file_ops`          | Read, write, or list files on the local filesystem       |

Tool implementations are defined in `src/copilot/tools.ts` and injected via a dependency object so they can be tested in isolation.

## Health Check

A periodic health check runs every 30 seconds (`HEALTH_CHECK_INTERVAL_MS`). It verifies that the `CopilotClient` is still in the `"connected"` state. If the client has disconnected:

1. It triggers `ensureClient()` to reset the connection
2. The current session is invalidated so the next message creates or resumes a fresh one
3. The failure is logged to stderr

## Error Handling

The orchestrator classifies errors into two categories and handles them differently:

- **Connection errors** (disconnect, EPIPE, ECONNRESET, etc.) — The client is reset, the session is invalidated, and the message is retried.
- **Session errors** (expired, closed, not found) — The session is invalidated and the message is retried with a new session.

Each message gets up to 3 retry attempts (`MAX_RETRIES`). If all retries fail, the error is surfaced to the user as a readable message (`"Sorry, I encountered an error: …"`) rather than silently swallowed. Partial responses accumulated before a timeout are returned gracefully instead of discarded.

The `sendAndWait` call has a 10-minute timeout (`SEND_TIMEOUT_MS = 600_000`) to accommodate long-running tool executions.
