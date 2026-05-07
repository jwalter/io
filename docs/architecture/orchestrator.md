# Orchestrator

The orchestrator is the brain of IO. It receives every user message and decides whether to **respond directly** or **delegate to a specialist squad**.

## Design Philosophy

IO uses a **hybrid approach**: the orchestrator handles simple, conversational messages itself (greetings, general knowledge, explanations) and delegates complex, project-specific work to agent squads. This gives you a natural conversational experience while still leveraging specialist agents for deep work.

- **Direct responses**: Greetings, general knowledge, simple explanations, status queries
- **Squad delegation**: Code generation, project-specific tasks, file operations, multi-step workflows
- **Composability**: Squads can be dynamically assembled for any project
- **Observability**: All routing decisions are logged and auditable

## How Routing Works

```
User message arrives
       │
       ▼
  Is it conversational?
  ┌─────┴─────┐
  │ Yes       │ No
  ▼           ▼
Respond    Delegate to
directly   squad agents
```

When the full Copilot SDK is integrated, the LLM itself makes this decision naturally — it either responds with text (direct) or calls squad management tools (delegation). During facade mode, a local heuristic handles the routing.

### Direct Response Examples

```
User: "Hello!"
IO: "Hey there! 👋 I'm IO, your personal AI assistant."

User: "What is a mutex?"
IO: "A mutex (mutual exclusion) is a synchronization primitive..."

User: "What can you do?"
IO: "I can chat, manage squads, search your wiki, and more..."
```

### Squad Delegation Examples

```
User: "Help me refactor the auth module in project X"

Orchestrator:
  1. squad_recall("project-x") → existing squad with 3 agents
  2. Evaluates: no security specialist exists
  3. squad_hire({ squad: "project-x", role: "Security Specialist" })
  4. squad_route({ agent: "security-specialist", task: "Review auth module..." })
  5. Agent executes, returns results
  6. Orchestrator synthesizes and relays to user
```

## Tool Definitions

The orchestrator has access to six tools for squad management:

| Tool            | Description                                          |
| --------------- | ---------------------------------------------------- |
| `squad_recall`  | Recall an existing squad for a project               |
| `squad_create`  | Create a new squad for a project                     |
| `squad_hire`    | Hire a new specialist agent into a squad              |
| `squad_route`   | Route a task to a specific agent in a squad           |
| `squad_status`  | Get the current status of a squad and its agents      |
| `squad_decide`  | Record a decision in the squad's decision log         |

## Bridge Architecture

Because `rusqlite::Connection` is `!Send` (contains `RefCell`), the orchestrator runs on a **dedicated OS thread** with its own single-threaded Tokio runtime. The bridge module (`src/bridge.rs`) handles communication between the main async runtime and the orchestrator thread via channels.

```
Main Tokio Runtime ←→ Bridge (channels) ←→ Orchestrator Thread (LocalSet)
```

This ensures thread safety while allowing the orchestrator to use SQLite directly.
