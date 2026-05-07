# Skills

IO supports the open [Agent Skills](https://agentskills.io) format — a lightweight standard for extending AI agent capabilities with specialized knowledge and workflows.

## What Are Skills?

Skills are folders containing a `SKILL.md` file with metadata and instructions that teach IO how to perform specific tasks. Unlike compiled tools, skills are **contextual instructions** that the LLM loads on demand.

```
my-skill/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
└── assets/           # Optional: templates, resources
```

## How Skills Work

IO uses **progressive disclosure** to keep token usage low:

1. **Discovery** — On startup, IO scans skill directories and loads only name + description (~100 tokens each)
2. **Activation** — When a task matches a skill's description, IO loads the full `SKILL.md` instructions
3. **Resources** — Scripts and reference files are loaded only when the instructions reference them

## Installing Skills

### From skills.sh

[skills.sh](https://skills.sh) is an open registry of 34,000+ community skills:

```bash
# Search for skills
io skill search "pdf processing"

# Install a skill
io skill add anthropics/skills@pdf

# List installed skills
io skill list

# Remove a skill
io skill remove pdf
```

### Manually

Place a skill folder in any of these directories:

| Scope   | Path                    | Description                    |
| ------- | ----------------------- | ------------------------------ |
| User    | `~/.io/skills/`         | IO-specific, available always  |
| User    | `~/.agents/skills/`     | Cross-client interop           |
| Project | `./.io/skills/`         | Project-specific               |
| Project | `./.agents/skills/`     | Cross-client interop           |

Project-scope skills override user-scope when names collide.

## Writing a Skill

### 1. Create the directory and SKILL.md

```bash
mkdir -p ~/.io/skills/my-skill
```

Create `~/.io/skills/my-skill/SKILL.md`:

```yaml
---
name: my-skill
description: "Brief description of what the skill does. Include trigger keywords like 'when asked to X' or 'use for Y'."
license: MIT
metadata:
  author: your-name
  version: "1.0"
---

# My Skill Instructions

Step-by-step instructions for IO go here. Write in clear, imperative language.

## When to use

- When the user asks to...
- When the task involves...

## Steps

1. First, do this
2. Then, do that
3. Finally, return the result

## Examples

Input: "example request"
Output: "example response"
```

### 2. Restart IO

Skills are scanned on startup. Restart the daemon to pick up new skills:

```bash
sudo systemctl restart io
```

### Tips

- **Name**: lowercase, alphanumeric + hyphens, must match the folder name
- **Description**: include trigger keywords — IO uses this to decide when to activate the skill
- **Body**: keep under 5,000 tokens (~500 lines) for best performance
- **References**: link to specific files (`references/spec.md`), not directories

## LLM Integration

The orchestrator exposes three skill-related tools to the LLM:

| Tool             | Description                                        |
| ---------------- | -------------------------------------------------- |
| `activate_skill` | Load a skill's full instructions into context       |
| `skill_search`   | Search the skills.sh registry                      |
| `skill_install`  | Install a skill from skills.sh                     |

When IO starts, all installed skills' names and descriptions are injected into the system prompt as an `<available_skills>` catalog. The LLM uses `activate_skill` to load full instructions only when needed.
