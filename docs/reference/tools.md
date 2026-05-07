# Tools

IO provides the orchestrator with a set of built-in tools for interacting with the local system and external services. The LLM decides when to call these tools based on the user's request.

## Tool Architecture

All tools implement the `Tool` trait:

```rust
#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> Value;
    async fn execute(&self, args: Value) -> Result<ToolResult>;
}
```

Tools are registered in the `ToolRegistry` and automatically exposed to the orchestrator's LLM via the GitHub Models API tool calling interface. The orchestrator merges registry tools with its built-in squad management tools so the model can call any of them.

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

## Adding a New Tool

Adding a custom tool to IO takes three steps:

### 1. Implement the `Tool` trait

Create a new file in `src/tools/` (e.g., `src/tools/my_tool.rs`):

```rust
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};

use super::{Tool, ToolResult};

pub struct MyTool;

#[async_trait]
impl Tool for MyTool {
    fn name(&self) -> &str {
        "my_tool"
    }

    fn description(&self) -> &str {
        "A brief description of what this tool does"
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "input": {
                    "type": "string",
                    "description": "The input to process"
                }
            },
            "required": ["input"]
        })
    }

    async fn execute(&self, args: Value) -> Result<ToolResult> {
        let input = args["input"].as_str().unwrap_or("");

        // Your tool logic here
        let output = format!("Processed: {input}");

        Ok(ToolResult {
            success: true,
            output,
            metadata: None,
        })
    }
}
```

### 2. Register the module

Add your module to `src/tools/mod.rs`:

```rust
pub mod my_tool;
```

### 3. Register in the default registry

In `src/tools/mod.rs`, add your tool to `register_defaults()`:

```rust
pub fn register_defaults() -> Self {
    let mut registry = Self::new();
    registry.register(Box::new(FileOpsTool));
    registry.register(Box::new(ShellTool));
    registry.register(Box::new(WebTool));
    registry.register(Box::new(WikiTool::new()));
    registry.register(Box::new(CalendarTool::new()));
    registry.register(Box::new(my_tool::MyTool));  // Add here
    registry
}
```

That's it — the orchestrator will automatically pick up the new tool and make it available to the LLM. The model will call your tool when it determines the user's request matches the tool's description.

### Tips

- **Name**: Use `snake_case` — this is the name the LLM uses to call the tool
- **Description**: Be specific — the LLM uses this to decide when to call your tool
- **Parameters schema**: Follow [JSON Schema](https://json-schema.org/) — the LLM generates arguments matching this schema
- **Error handling**: Return `Err(...)` for hard failures; use `ToolResult { success: false, ... }` for soft failures the LLM can recover from

## Tool Permissions

Tools execute with the same permissions as the IO process. When running as a systemd service, this is typically the root user (or whichever user the service runs as).

Consider creating a dedicated user for the daemon in production:

```bash
useradd -r -s /bin/nologin io
```
