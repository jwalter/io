# Squads

Squads are persistent, per-project teams of specialized AI agents. Unlike ephemeral chat sessions, squads accumulate knowledge about your projects over time.

## Concepts

### Squad

A squad is a team of agents assigned to a specific project. It persists at `~/.io-daemon/squads/{project-slug}/` and is recalled whenever you work on that project.

### Agent

An agent is a specialized role within a squad. Each agent has:

- **Charter** (`charter.md`): Defines identity, role, and specializations
- **History** (`history.md`): Accumulated learnings about the project

### Hiring

When the orchestrator determines that the current squad lacks expertise for a task, it can "hire" a new agent — generating a charter and adding it to the squad.

## Squad Lifecycle

```
1. New project → orchestrator creates a squad
2. First task → orchestrator hires initial agents
3. Ongoing work → agents accumulate history
4. New domain → orchestrator hires specialists
5. Project dormant → squad persists on disk
6. Project revisited → squad is recalled with full context
```

## File Structure

```
~/.io-daemon/squads/
└── my-web-app/
    ├── squad.toml       # Metadata: project path, created date, last active
    ├── routing.md       # Pattern → agent routing rules
    ├── decisions.md     # Append-only decision log
    └── agents/
        ├── frontend-dev/
        │   ├── charter.md   # "You are a frontend specialist..."
        │   └── history.md   # "Project uses React 18, TypeScript strict..."
        └── api-engineer/
            ├── charter.md
            └── history.md
```

## Charter Templates

When a new agent is hired, a charter is generated from a template:

```markdown
# {Agent Name}

## Role
{Role description}

## Specializations
- {Specialization 1}
- {Specialization 2}

## Guidelines
- Always consider the project's existing patterns
- Document decisions in the squad decision log
- Share learnings that might benefit other agents
```

The orchestrator customizes the template based on the specific hiring context.

## Decision Log

Every significant decision made by a squad is recorded in `decisions.md`:

```markdown
## 2025-05-06: Auth Module Refactoring

**Agent**: security-specialist
**Decision**: Use bcrypt for password hashing instead of argon2
**Rationale**: Project already has bcrypt as a dependency, and the threat
model doesn't require argon2's memory-hard properties.
```

This provides an audit trail and helps agents make consistent decisions over time.

## Routing Rules

`routing.md` defines patterns for routing messages to specific agents:

```markdown
## Routing Rules

- Frontend, UI, CSS, React → frontend-dev
- API, endpoint, REST, GraphQL → api-engineer
- Security, auth, permissions → security-specialist
- Default → frontend-dev (primary agent)
```

## Cross-Squad Knowledge

Agents can share knowledge across squads through the [Knowledge System](/architecture/knowledge). This enables learnings from one project to benefit others — for example, a security best practice discovered in Project A can be applied to Project B.
