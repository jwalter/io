# WebSocket Events

IO uses WebSocket for real-time communication with the web dashboard. Connect to:

```
ws://localhost:7777
```

## Connection

On connect, the server sends:

```json
{ "type": "connected", "payload": { "channels": [] } }
```

## Subscribing to Channels

Clients subscribe to channels to receive filtered events:

```json
{ "type": "subscribe", "channels": ["chat", "activity", "inbox"] }
```

Available channels:
- `chat` — Chat stream events
- `activity` — Squad, objective, task, agent, review, QA, and PR events
- `inbox` — Inbox and notification events
- `<squadId>` — Events for a specific squad

## Event Format

All events are JSON messages with a `type` and `payload` field:

```json
{
  "type": "chat.stream_chunk",
  "channel": "chat",
  "payload": { ... }
}
```

## Events

### Chat Events

| Event | Payload | Description |
|-------|---------|-------------|
| `chat.message` | `{ conversationId, content }` | New chat message |
| `chat.stream_chunk` | `StreamChunk` | Streaming token from Io |
| `chat.stream_end` | `{ conversationId, messageId }` | Response complete |

### Squad Events

| Event | Payload | Description |
|-------|---------|-------------|
| `squad.created` | `{ squad }` | New squad created |
| `squad.updated` | `{ squad }` | Squad updated |
| `squad.deleted` | `{ squadId }` | Squad removed |

### Objective Events

| Event | Payload | Description |
|-------|---------|-------------|
| `objective.started` | `{ objective }` | Objective execution began |
| `objective.completed` | `{ objective }` | Objective finished |
| `objective.failed` | `{ objective, reason }` | Objective failed |

### Task Events

| Event | Payload | Description |
|-------|---------|-------------|
| `task.started` | `{ task, agentName }` | Agent started a task |
| `task.completed` | `{ task, agentName }` | Agent finished a task |
| `task.failed` | `{ task, agentName, reason }` | Task failed |

### Agent Events

| Event | Payload | Description |
|-------|---------|-------------|
| `agent.executing` | `{ squadId, agentId, taskId }` | Agent is actively working |
| `agent.completed` | `{ squadId, agentId, taskId }` | Agent finished |

### Review & QA Events

| Event | Payload | Description |
|-------|---------|-------------|
| `review.started` | `{ objectiveId }` | Review meeting began |
| `review.completed` | `{ objectiveId, summary }` | Review finished |
| `qa.approved` | `{ objectiveId }` | QA approved the work |
| `qa.rejected` | `{ objectiveId, reason, revisionCount }` | QA rejected |
| `qa.escalated` | `{ objectiveId, reason }` | Escalated after max rejections |

### PR Events

| Event | Payload | Description |
|-------|---------|-------------|
| `pr.created` | `{ objectiveId, prUrl }` | PR created |
| `pr.merged` | `{ objectiveId, prUrl }` | PR merged |

### Inbox Events

| Event | Payload | Description |
|-------|---------|-------------|
| `inbox.new_item` | `{ item }` | New inbox item |
| `inbox.replied` | `{ itemId, reply }` | Reply sent to inbox item |
| `notification` | `{ title, body, channel }` | General notification |

## Client Example

```javascript
const ws = new WebSocket('ws://localhost:7777');

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'subscribe', channels: ['chat', 'activity'] }));
};

ws.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);

  switch (type) {
    case 'chat.stream_chunk':
      appendToChat(payload.content);
      break;
    case 'pr.created':
      showNotification(`PR created: ${payload.prUrl}`);
      break;
    case 'inbox.new_item':
      refreshInbox();
      break;
  }
};
```
