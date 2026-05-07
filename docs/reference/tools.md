# Tools

IO provides agents with a set of built-in tools for interacting with the local system and external services.

## Tool Architecture

All tools implement the `Tool` trait:

```rust
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> serde_json::Value;
    async fn execute(&self, params: serde_json::Value) -> Result<String>;
}
```

Tools are registered in a global registry and made available to agents during their Copilot sessions.

## Built-in Tools

### File Operations

Read, write, search, and list files on the local filesystem.

| Function    | Description                           |
| ----------- | ------------------------------------- |
| `read`      | Read file contents                    |
| `write`     | Write or overwrite a file             |
| `search`    | Search file contents with regex       |
| `list`      | List directory contents               |

### Shell

Execute shell commands and capture output.

| Function    | Description                           |
| ----------- | ------------------------------------- |
| `execute`   | Run a command and return stdout/stderr |

::: warning
Shell commands execute with the daemon's permissions. The tool includes basic safety checks but should be used with caution.
:::

### Web

Fetch content from URLs.

| Function    | Description                           |
| ----------- | ------------------------------------- |
| `fetch`     | HTTP GET a URL and return content      |
| `search`    | Web search (when configured)          |

### Wiki

CRUD operations on the markdown knowledge base.

| Function    | Description                           |
| ----------- | ------------------------------------- |
| `read`      | Read a wiki page                      |
| `write`     | Create or update a wiki page          |
| `list`      | List all wiki pages                   |
| `search`    | Full-text search across wiki          |

### Calendar

Manage events and scheduling.

| Function    | Description                           |
| ----------- | ------------------------------------- |
| `list`      | List upcoming events                  |
| `create`    | Create a new event                    |
| `delete`    | Remove an event                       |

## Extensibility

The tool system is designed to be extensible:

- **Built-in tools** are compiled into the binary
- **Skill-provided tools** (future) will be loaded from installed skills
- The `Tool` trait supports dynamic dispatch via `Box<dyn Tool>`

## Tool Permissions

Tools execute with the same permissions as the IO process. When running as a systemd service, this is typically the root user (or whichever user the service runs as).

Consider creating a dedicated user for the daemon in production:

```bash
useradd -r -s /bin/nologin io
```
