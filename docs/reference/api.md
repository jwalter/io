# REST API

IO exposes a REST API on port 7777 (configurable). All endpoints return JSON.

## Base URL

```
http://localhost:7777/api
```

## Authentication

If Supabase is configured, requests must include a valid JWT:

```
Authorization: Bearer <supabase-jwt>
```

Without Supabase config, all endpoints are open.

---

## Chat

### Send Message

```http
POST /api/chat
Content-Type: application/json

{
  "message": "What's the status of my squads?",
  "conversationId": "optional-existing-id",
  "source": "web"
}
```

**Response:** JSON with conversation and message data. Streaming happens via WebSocket (`chat.stream_chunk` events).

### List Conversations

```http
GET /api/conversations?limit=50&offset=0
```

### Get Conversation

```http
GET /api/conversations/:id
```

### Delete Conversation

```http
DELETE /api/conversations/:id
```

---

## Squads

### List Squads

```http
GET /api/squads
```

### Get Squad

```http
GET /api/squads/:id
```

### Create Squad (Hire)

```http
POST /api/squads
Content-Type: application/json

{
  "repoUrl": "https://github.com/org/repo",
  "prMode": "draft-pr"
}
```

### Update Squad

```http
PUT /api/squads/:id
Content-Type: application/json

{
  "config": {
    "prMode": "ready-pr"
  }
}
```

### Delete Squad (Fire)

```http
DELETE /api/squads/:id
```

### Get Squad Members

```http
GET /api/squads/:id/members
```

### Create Objective

```http
POST /api/squads/:id/objectives
Content-Type: application/json

{
  "description": "Add dark mode support"
}
```

### List Objectives

```http
GET /api/squads/:id/objectives
```

---

## Inbox

### List Inbox Items

```http
GET /api/inbox
```

### Reply to Item

```http
POST /api/inbox/:id/reply
Content-Type: application/json

{
  "message": "Approved, proceed with option A"
}
```

### Mark as Read

```http
PUT /api/inbox/:id/read
```

---

## Schedules

### List Schedules

```http
GET /api/schedules
```

### Create Schedule

```http
POST /api/schedules
Content-Type: application/json

{
  "name": "Daily Standup",
  "cron": "0 9 * * *",
  "prompt": "Summarize yesterday's squad activity",
  "enabled": true
}
```

### Update Schedule

```http
PUT /api/schedules/:id
Content-Type: application/json

{
  "enabled": false
}
```

### Delete Schedule

```http
DELETE /api/schedules/:id
```

---

## Wiki

### List Pages

```http
GET /api/wiki/pages
```

### Get Page

```http
GET /api/wiki/pages/:path
```

### Create Page

```http
POST /api/wiki/pages
Content-Type: application/json

{
  "path": "projects/my-app",
  "content": "# My App\n\nA React dashboard...",
  "tags": ["project", "react"]
}
```

### Update Page

```http
PUT /api/wiki/pages/:path
Content-Type: application/json

{
  "content": "# My App\n\nUpdated content...",
  "tags": ["project", "react"]
}
```

### Delete Page

```http
DELETE /api/wiki/pages/:path
```

### Search Wiki

```http
GET /api/wiki/search?q=typescript
```

---

## Skills

### List Skills

```http
GET /api/skills
```

### Install Skill

```http
POST /api/skills/install
Content-Type: application/json

{
  "url": "https://github.com/user/repo/tree/main/skills/my-skill"
}
```

### Remove Skill

```http
DELETE /api/skills/:id
```

### Discover Skills

```http
GET /api/skills/discover
```

> Note: This endpoint is a placeholder and currently returns an empty array.

---

## Usage

### Get Token Usage

```http
GET /api/usage?from=2024-12-01&to=2024-12-31&squadId=optional
```

---

## Activity

### Get Activity Feed

```http
GET /api/activity?limit=50&offset=0
```

---

## Settings

### Get Settings

```http
GET /api/settings
```

### Update Settings

```http
PUT /api/settings
Content-Type: application/json

{
  "port": 7777,
  "logLevel": "debug"
}
```
