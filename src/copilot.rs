//! GitHub Models API client.
//!
//! Calls `https://models.github.ai/inference/chat/completions` directly
//! using the token from `gh auth token`. OpenAI-compatible request/response
//! format with streaming (SSE) and tool calling support.

use anyhow::{Context, Result};
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

const API_BASE: &str = "https://models.github.ai/inference";

// ─── Public types ───────────────────────────────────────────────────────────

/// A message in the conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    pub fn assistant_with_tool_calls(tool_calls: Vec<ToolCall>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: None,
            tool_calls: Some(tool_calls),
            tool_call_id: None,
        }
    }

    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: "tool".to_string(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
        }
    }
}

/// A tool call requested by the model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

/// Function name + arguments in a tool call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

/// Tool definition (OpenAI format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: FunctionDefinition,
}

impl ToolDefinition {
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: serde_json::Value,
    ) -> Self {
        Self {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: name.into(),
                description: description.into(),
                parameters,
            },
        }
    }
}

/// Function schema within a tool definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// The result of a chat completion call.
#[derive(Debug)]
pub enum ChatResponse {
    /// Model responded with text content.
    Message(String),
    /// Model wants to call tools.
    ToolCalls(Vec<ToolCall>),
}

// ─── Streaming types ────────────────────────────────────────────────────────

/// A single streaming chunk delta.
#[derive(Debug)]
pub enum StreamDelta {
    /// A piece of text content.
    Content(String),
    /// Stream is done; final assembled tool calls (if any).
    Done(Option<Vec<ToolCall>>),
}

// ─── Internal response types ────────────────────────────────────────────────

#[derive(Deserialize)]
struct ApiResponse {
    choices: Vec<ApiChoice>,
}

#[derive(Deserialize)]
struct ApiChoice {
    message: ApiMessage,
}

#[derive(Deserialize)]
struct ApiMessage {
    content: Option<String>,
    tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: StreamDeltaRaw,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct StreamDeltaRaw {
    content: Option<String>,
    tool_calls: Option<Vec<StreamToolCall>>,
}

#[derive(Deserialize)]
struct StreamToolCall {
    index: usize,
    id: Option<String>,
    #[serde(rename = "type")]
    call_type: Option<String>,
    function: Option<StreamFunction>,
}

#[derive(Deserialize)]
struct StreamFunction {
    name: Option<String>,
    arguments: Option<String>,
}

// ─── Client ─────────────────────────────────────────────────────────────────

/// GitHub Models API client.
pub struct GithubModelsClient {
    http: Client,
    token: String,
}

impl GithubModelsClient {
    /// Create a new client by obtaining a token from `gh auth token`.
    pub async fn new() -> Result<Self> {
        let token = get_gh_token().context("Failed to get GitHub token from `gh auth token`")?;
        debug!("GitHub Models client initialized");
        Ok(Self {
            http: Client::new(),
            token,
        })
    }

    /// Non-streaming chat completion.
    pub async fn chat_completion(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        model: &str,
    ) -> Result<ChatResponse> {
        debug!(model = %model, message_count = messages.len(), "Sending chat completion request");

        let adapted_messages = adapt_messages_for_model(messages, model);
        let mut body = serde_json::json!({
            "model": model,
            "messages": adapted_messages,
            "max_completion_tokens": 4096,
        });

        if !tools.is_empty() {
            body["tools"] = serde_json::to_value(tools)?;
            body["tool_choice"] = serde_json::json!("auto");
        }

        let response = self
            .http
            .post(format!("{API_BASE}/chat/completions"))
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Content-Type", "application/json")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&body)
            .send()
            .await
            .context("Failed to send request to GitHub Models API")?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            warn!(model = %model, status = %status, "GitHub Models API request failed");
            anyhow::bail!("GitHub Models API returned {status}: {error_body}");
        }

        let api_response: ApiResponse = response
            .json()
            .await
            .context("Failed to parse GitHub Models API response")?;

        let choice = api_response
            .choices
            .into_iter()
            .next()
            .context("No choices in API response")?;

        if let Some(tool_calls) = choice.message.tool_calls {
            if !tool_calls.is_empty() {
                debug!(model = %model, tool_count = tool_calls.len(), "Model requested tool calls");
                return Ok(ChatResponse::ToolCalls(tool_calls));
            }
        }

        debug!(model = %model, "Model responded with message");
        Ok(ChatResponse::Message(
            choice.message.content.unwrap_or_default(),
        ))
    }

    /// Streaming chat completion. Calls `on_delta` for each content chunk.
    /// Returns the final assembled response.
    pub async fn chat_completion_stream<F>(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        model: &str,
        mut on_delta: F,
    ) -> Result<ChatResponse>
    where
        F: FnMut(&str),
    {
        debug!(model = %model, message_count = messages.len(), "Sending streaming chat completion request");

        let adapted_messages = adapt_messages_for_model(messages, model);
        let mut body = serde_json::json!({
            "model": model,
            "messages": adapted_messages,
            "max_completion_tokens": 4096,
            "stream": true,
        });

        if !tools.is_empty() {
            body["tools"] = serde_json::to_value(tools)?;
            body["tool_choice"] = serde_json::json!("auto");
        }

        let response = self
            .http
            .post(format!("{API_BASE}/chat/completions"))
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Content-Type", "application/json")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&body)
            .send()
            .await
            .context("Failed to send streaming request to GitHub Models API")?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            warn!(model = %model, status = %status, "GitHub Models API streaming request failed");
            anyhow::bail!("GitHub Models API returned {status}: {error_body}");
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut full_content = String::new();
        let mut tool_calls_builder: Vec<(String, String, String, String)> = Vec::new(); // (id, type, name, args)

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.context("Stream read error")?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim().to_string();
                buffer = buffer[newline_pos + 1..].to_string();

                if line.is_empty() || !line.starts_with("data: ") {
                    continue;
                }

                let data = &line[6..];
                if data == "[DONE]" {
                    break;
                }

                if let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) {
                    if let Some(choice) = chunk.choices.first() {
                        // Handle content deltas
                        if let Some(content) = &choice.delta.content {
                            if !content.is_empty() {
                                on_delta(content);
                                full_content.push_str(content);
                            }
                        }

                        // Handle tool call deltas
                        if let Some(tc_deltas) = &choice.delta.tool_calls {
                            for tc in tc_deltas {
                                let idx = tc.index;
                                // Ensure builder vec is large enough
                                while tool_calls_builder.len() <= idx {
                                    tool_calls_builder.push((
                                        String::new(),
                                        String::new(),
                                        String::new(),
                                        String::new(),
                                    ));
                                }
                                if let Some(id) = &tc.id {
                                    tool_calls_builder[idx].0 = id.clone();
                                }
                                if let Some(ct) = &tc.call_type {
                                    tool_calls_builder[idx].1 = ct.clone();
                                }
                                if let Some(func) = &tc.function {
                                    if let Some(name) = &func.name {
                                        tool_calls_builder[idx].2 = name.clone();
                                    }
                                    if let Some(args) = &func.arguments {
                                        tool_calls_builder[idx].3.push_str(args);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Assemble final response
        if !tool_calls_builder.is_empty()
            && tool_calls_builder
                .iter()
                .any(|(id, _, _, _)| !id.is_empty())
        {
            let tool_calls: Vec<ToolCall> = tool_calls_builder
                .into_iter()
                .filter(|(id, _, _, _)| !id.is_empty())
                .map(|(id, call_type, name, arguments)| ToolCall {
                    id,
                    call_type: if call_type.is_empty() {
                        "function".to_string()
                    } else {
                        call_type
                    },
                    function: FunctionCall { name, arguments },
                })
                .collect();
            return Ok(ChatResponse::ToolCalls(tool_calls));
        }

        Ok(ChatResponse::Message(full_content))
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Returns true if the model is a reasoning model that requires "developer"
/// role instead of "system" role (e.g., o1, o3, o4-mini).
fn is_reasoning_model(model: &str) -> bool {
    // Strip any provider prefix (e.g. "openai/o3-mini" -> "o3-mini")
    let name = model.rsplit('/').next().unwrap_or(model);
    name.starts_with("o1") || name.starts_with("o3") || name.starts_with("o4")
}

/// Adapt messages for the target model. Reasoning models (o1, o3, o4-mini)
/// require "developer" role instead of "system" role.
fn adapt_messages_for_model(messages: &[ChatMessage], model: &str) -> Vec<ChatMessage> {
    if !is_reasoning_model(model) {
        return messages.to_vec();
    }

    messages
        .iter()
        .map(|msg| {
            if msg.role == "system" {
                ChatMessage {
                    role: "developer".to_string(),
                    ..msg.clone()
                }
            } else {
                msg.clone()
            }
        })
        .collect()
}

/// Get the GitHub token, checking `GITHUB_TOKEN` env var first,
/// then falling back to `gh auth token`.
fn get_gh_token() -> Result<String> {
    // Prefer environment variable (works in systemd, Docker, CI)
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        let token = token.trim().to_string();
        if !token.is_empty() {
            return Ok(token);
        }
    }

    // Fall back to gh CLI (works in interactive/dev shells)
    let output = std::process::Command::new("gh")
        .args(["auth", "token"])
        .output()
        .context("Failed to run `gh auth token`. Is the GitHub CLI installed?")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(
            "`gh auth token` failed (exit {}): {}. Set GITHUB_TOKEN env var or run `gh auth login`.",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        );
    }

    let token = String::from_utf8(output.stdout)
        .context("gh auth token output is not valid UTF-8")?
        .trim()
        .to_string();

    if token.is_empty() {
        anyhow::bail!(
            "`gh auth token` returned empty. Set GITHUB_TOKEN env var or run `gh auth login`."
        );
    }

    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_message_constructors() {
        let sys = ChatMessage::system("hello");
        assert_eq!(sys.role, "system");
        assert_eq!(sys.content.as_deref(), Some("hello"));

        let user = ChatMessage::user("question");
        assert_eq!(user.role, "user");

        let asst = ChatMessage::assistant("answer");
        assert_eq!(asst.role, "assistant");

        let tool = ChatMessage::tool_result("call-1", "result");
        assert_eq!(tool.role, "tool");
        assert_eq!(tool.tool_call_id.as_deref(), Some("call-1"));
    }

    #[test]
    fn test_tool_definition_new() {
        let td = ToolDefinition::new("test_tool", "A test", serde_json::json!({"type": "object"}));
        assert_eq!(td.tool_type, "function");
        assert_eq!(td.function.name, "test_tool");
    }

    #[test]
    fn test_is_reasoning_model() {
        assert!(is_reasoning_model("openai/o1"));
        assert!(is_reasoning_model("openai/o1-mini"));
        assert!(is_reasoning_model("openai/o1-preview"));
        assert!(is_reasoning_model("openai/o3"));
        assert!(is_reasoning_model("openai/o3-mini"));
        assert!(is_reasoning_model("openai/o4-mini"));
        assert!(is_reasoning_model("openai/o4"));
        assert!(is_reasoning_model("o3-mini"));

        assert!(!is_reasoning_model("openai/gpt-4.1"));
        assert!(!is_reasoning_model("openai/gpt-4o-mini"));
        assert!(!is_reasoning_model("claude-sonnet-4-5"));
    }

    #[test]
    fn test_adapt_messages_for_reasoning_model() {
        let messages = vec![
            ChatMessage::system("You are helpful"),
            ChatMessage::user("Hi"),
        ];

        let adapted = adapt_messages_for_model(&messages, "openai/o3-mini");
        assert_eq!(adapted[0].role, "developer");
        assert_eq!(adapted[0].content.as_deref(), Some("You are helpful"));
        assert_eq!(adapted[1].role, "user");
    }

    #[test]
    fn test_adapt_messages_for_standard_model() {
        let messages = vec![
            ChatMessage::system("You are helpful"),
            ChatMessage::user("Hi"),
        ];

        let adapted = adapt_messages_for_model(&messages, "openai/gpt-4.1");
        assert_eq!(adapted[0].role, "system");
        assert_eq!(adapted[1].role, "user");
    }
}
