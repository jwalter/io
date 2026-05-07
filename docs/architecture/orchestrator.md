# Orchestrator

The orchestrator is the routing brain of io-daemon. It receives every user message and determines which squad and agent(s) should handle the request. **It never generates responses directly.**

## Design Philosophy

Unlike typical chatbot architectures where a single model handles everything, io-daemon's orchestrator only makes routing decisions. This separation ensures:

- **Specialization**: Each agent focuses on what it knows best
- **Composability**: Squads can be dynamically assembled for any project
- **Observability**: All routing decisions are logged and auditable
- **Scalability**: Adding new capabilities means adding agents, not modifying the orchestrator

## System Prompt

The orchestrator operates with a system prompt that defines its role:

```
You are the IO Daemon Orchestrator. You NEVER generate artifacts directly.
Your job is to:
1. Understand the user's intent
2. Recall or compose the appropriate squad for the task
3. Route work to squad members via tools
4. Synthesize results back to the user
```

## Tool Definitions

The orchestrator has access to six tools for squad management:

| Tool            | Description                                          |
| --------------- | ---------------------------------------------------- |
| `squad_recall`  | Recall an existing squad for a project               |
| `squad_hire`    | Hire a new specialist agent into a squad              |
| `squad_route`   | Route a task to a specific agent in a squad           |
| `squad_status`  | Get the current status of a squad and its agents      |
| `squad_decide`  | Record a decision in the squad's decision log         |
| `wiki_search`   | Search the knowledge wiki for relevant context        |

## Routing Flow

```
1. User message arrives via event bus
2. Orchestrator analyzes intent
3. Calls squad_recall() to get the relevant squad
4. Evaluates: do current agents cover this task?
5. If not: calls squad_hire() to add a specialist
6. Calls squad_route() to delegate work
7. Agent executes with its own Copilot session
8. Results flow back through event bus → user
```

### Example

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

## Bridge Architecture

Because `rusqlite::Connection` is `!Send` (contains `RefCell`), the orchestrator runs on a **dedicated OS thread** with its own single-threaded Tokio runtime. The bridge module (`src/bridge.rs`) handles communication between the main async runtime and the orchestrator thread via channels.

```
Main Tokio Runtime ←→ Bridge (channels) ←→ Orchestrator Thread (LocalSet)
```

This ensures thread safety while allowing the orchestrator to use SQLite directly.
