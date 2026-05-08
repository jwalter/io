# Skills

IO supports the open [Agent Skills](https://agentskills.io) format — a lightweight standard for extending AI agent capabilities with specialized knowledge and workflows.

## What Are Skills?

Skills are folders containing a `SKILL.md` file — a plain markdown document with instructions that teach IO how to perform specific tasks. Unlike compiled tools, skills are **contextual instructions** that the LLM loads on demand.

```
my-skill/
├── SKILL.md          # Required: instructions (plain markdown)
├── agents/           # Optional: Copilot SDK custom agents
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
└── assets/           # Optional: templates, resources
```

## How Skills Work

IO uses **progressive disclosure** to keep token usage low:

1. **Discovery** — On startup, IO scans `~/.io/skills/` for subdirectories containing a `SKILL.md` file. It parses only the first heading (name) and first paragraph (description) from each file.
2. **Activation** — When a task matches a skill's description, IO loads the full `SKILL.md` instructions into the conversation context.
3. **Resources** — Scripts and reference files are loaded only when the instructions reference them.

## Installing Skills

### From skills.sh

[skills.sh](https://skills.sh) is an open registry of community skills. Use the CLI to discover and install them:

```bash
# Search for skills
io skill search "pdf processing"

# Install a skill (provide the git repo URL)
io skill add https://github.com/anthropics/skills-pdf.git

# List installed skills
io skill list

# Remove a skill by slug (folder name)
io skill remove skills-pdf
```

The `add` command clones the git repository into `~/.io/skills/`. If the cloned repo does not contain a `SKILL.md` file, the install is rolled back automatically.

### Manually

Create a subdirectory in `~/.io/skills/` containing a `SKILL.md` file:

```bash
mkdir -p ~/.io/skills/my-skill
# then create ~/.io/skills/my-skill/SKILL.md
```

## Writing a Skill

### 1. Create the directory and SKILL.md

```bash
mkdir -p ~/.io/skills/my-skill
```

Create `~/.io/skills/my-skill/SKILL.md` as a **plain markdown** file. IO extracts the skill name from the first `#` heading and the description from the first paragraph after it:

```markdown
# My Skill

Brief description of what the skill does. Include trigger keywords
like "when asked to X" or "use for Y" so IO knows when to activate it.

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

- **Folder name** becomes the skill's slug — use lowercase, alphanumeric + hyphens
- **First heading** (`# ...`) is used as the display name
- **First paragraph** after the heading is used as the description — include trigger keywords so IO knows when to activate the skill
- **Body**: keep under 5,000 tokens (~500 lines) for best performance
- **References**: link to specific files (`references/spec.md`), not directories

## LLM Integration

IO passes installed skill directories to the Copilot SDK via the `skillDirectories` session config. The SDK handles skill discovery and activation automatically — skill names and descriptions are injected into the system prompt, and the full `SKILL.md` content is loaded into context when the LLM determines a skill is relevant to the current task.
