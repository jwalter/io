# Web Dashboard

IO includes a React 19 web dashboard served from the daemon on port 3170 (configurable).

## Access

Once IO is running in daemon mode, open:

```
http://localhost:3170
```

## Authentication

The dashboard requires Supabase email/password authentication. Configure your Supabase credentials in `~/.io/config.json` (see [Configuration](/guide/configuration)).

Only the `authorizedEmail` address is allowed to sign in.

## Pages

### Chat
The primary interface — a real-time conversation with the IO orchestrator. Messages stream in token-by-token via Server-Sent Events.

You can attach files (including images) via the paperclip button or drag-and-drop. Attachments are sent with chat context and forwarded to Copilot sessions for multimodal prompts.

A floating Chat Overlay is also accessible from any page via the sidebar chat button.

Attachment limits:
- **10MB max per file**
- **25MB max total per message**

### Squads
Overview of all project squads as color-coded cards. Click a squad card to view agents, active instances, schedules, and task history. Each agent displays their character persona, role, current task, and status.

### Feed
Unified inbox for all deliverables from squads and the orchestrator. Split-panel layout with a filterable list on the left and a markdown reading pane on the right. Supports bulk actions (mark read, delete) and filter by read/unread status.

### Skills
Three-panel skill browser. Switch between Installed, Awesome Copilot, and skills.sh sources. View skill details including front matter, description, and version. Install and remove skills directly from the UI.

### MCP Servers
Manage external MCP tool servers. Add, remove, enable/disable servers, and toggle individual tools within each server.

### Schedules
Configure cron-based recurring tasks. Two tabs:
- **Squad Schedules** — recurring stand-ups delivered to squad leads
- **IO Schedules** — prompts delivered directly to the orchestrator

Create, edit, pause, resume, trigger, and delete schedules from the interface.

### Wiki
Browse and edit the `~/.io/wiki/` knowledge base. Collapsible file tree on the left, rendered markdown on the right with inline edit mode.

### Usage
Token consumption analytics with interactive charts. View daily usage bar charts, cost trend lines, and per-squad/per-agent breakdowns. Filter by date range.

### Settings
Configure IO parameters grouped by category: General, Telegram, Auth, Models, and Advanced. Sensitive fields are masked with toggle visibility.

## Tech Stack

- **React 19** with hooks
- **Zustand** for state management
- **React Router** with auth guards
- **Tailwind CSS v4** with custom dark theme (teal/coral palette)
- **Recharts** for usage analytics charts
- **Sonner** for toast notifications
- **Lucide** icons
- **Vite** for development and production builds
