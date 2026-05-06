//! Calendar tool for event management.

use anyhow::Result;
use async_trait::async_trait;
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use uuid::Uuid;

use super::{Tool, ToolResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CalendarEvent {
    id: String,
    title: String,
    date: String,
    time: Option<String>,
    description: Option<String>,
}

pub struct CalendarTool {
    calendar_dir: PathBuf,
}

impl CalendarTool {
    pub fn new() -> Self {
        let calendar_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".io-daemon")
            .join("calendar");
        Self { calendar_dir }
    }

    fn events_path(&self) -> PathBuf {
        self.calendar_dir.join("events.json")
    }

    async fn load_events(&self) -> Result<Vec<CalendarEvent>> {
        let path = self.events_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let content = tokio::fs::read_to_string(&path).await?;
        let events: Vec<CalendarEvent> = serde_json::from_str(&content)?;
        Ok(events)
    }

    async fn save_events(&self, events: &[CalendarEvent]) -> Result<()> {
        tokio::fs::create_dir_all(&self.calendar_dir).await?;
        let content = serde_json::to_string_pretty(events)?;
        tokio::fs::write(self.events_path(), content).await?;
        Ok(())
    }
}

#[async_trait]
impl Tool for CalendarTool {
    fn name(&self) -> &str {
        "calendar"
    }

    fn description(&self) -> &str {
        "Manage calendar events: add, list, and remove events"
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["add_event", "list_events", "remove_event"],
                    "description": "The calendar operation to perform"
                },
                "title": {
                    "type": "string",
                    "description": "Event title (for add_event)"
                },
                "date": {
                    "type": "string",
                    "description": "Event date in YYYY-MM-DD format"
                },
                "time": {
                    "type": "string",
                    "description": "Event time in HH:MM format (optional)"
                },
                "description": {
                    "type": "string",
                    "description": "Event description (optional)"
                },
                "days_ahead": {
                    "type": "integer",
                    "description": "Number of days ahead to list events (default: 7)",
                    "default": 7
                },
                "id": {
                    "type": "string",
                    "description": "Event ID (for remove_event)"
                }
            },
            "required": ["operation"]
        })
    }

    async fn execute(&self, args: Value) -> Result<ToolResult> {
        let operation = args["operation"].as_str().unwrap_or("");

        match operation {
            "add_event" => {
                let title = args["title"].as_str().unwrap_or("");
                let date = args["date"].as_str().unwrap_or("");
                let time = args["time"].as_str().map(String::from);
                let description = args["description"].as_str().map(String::from);
                self.add_event(title, date, time, description).await
            }
            "list_events" => {
                let days_ahead = args["days_ahead"].as_u64().unwrap_or(7) as i64;
                self.list_events(days_ahead).await
            }
            "remove_event" => {
                let id = args["id"].as_str().unwrap_or("");
                self.remove_event(id).await
            }
            _ => Ok(ToolResult {
                success: false,
                output: format!("Unknown operation: {operation}"),
                metadata: None,
            }),
        }
    }
}

impl CalendarTool {
    async fn add_event(
        &self,
        title: &str,
        date: &str,
        time: Option<String>,
        description: Option<String>,
    ) -> Result<ToolResult> {
        if title.is_empty() || date.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: "Title and date are required".to_string(),
                metadata: None,
            });
        }

        // Validate date format
        if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Ok(ToolResult {
                success: false,
                output: "Invalid date format. Use YYYY-MM-DD.".to_string(),
                metadata: None,
            });
        }

        let event = CalendarEvent {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            date: date.to_string(),
            time,
            description,
        };

        let mut events = self.load_events().await?;
        let event_id = event.id.clone();
        events.push(event);
        self.save_events(&events).await?;

        Ok(ToolResult {
            success: true,
            output: format!("Event added with ID: {event_id}"),
            metadata: Some(json!({ "id": event_id })),
        })
    }

    async fn list_events(&self, days_ahead: i64) -> Result<ToolResult> {
        let events = self.load_events().await?;
        let today = Utc::now().date_naive();
        let end_date = today + chrono::Duration::days(days_ahead);

        let upcoming: Vec<&CalendarEvent> = events
            .iter()
            .filter(|e| {
                if let Ok(date) = NaiveDate::parse_from_str(&e.date, "%Y-%m-%d") {
                    date >= today && date <= end_date
                } else {
                    false
                }
            })
            .collect();

        if upcoming.is_empty() {
            return Ok(ToolResult {
                success: true,
                output: format!("No events in the next {days_ahead} days."),
                metadata: Some(json!({ "count": 0 })),
            });
        }

        let output = upcoming
            .iter()
            .map(|e| {
                let time_str = e.time.as_deref().unwrap_or("all-day");
                let desc = e.description.as_deref().unwrap_or("");
                format!(
                    "[{}] {} {} - {}{}",
                    e.id,
                    e.date,
                    time_str,
                    e.title,
                    if desc.is_empty() {
                        String::new()
                    } else {
                        format!(" ({desc})")
                    }
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        Ok(ToolResult {
            success: true,
            output,
            metadata: Some(json!({ "count": upcoming.len() })),
        })
    }

    async fn remove_event(&self, id: &str) -> Result<ToolResult> {
        if id.is_empty() {
            return Ok(ToolResult {
                success: false,
                output: "Event ID is required".to_string(),
                metadata: None,
            });
        }

        let mut events = self.load_events().await?;
        let original_len = events.len();
        events.retain(|e| e.id != id);

        if events.len() == original_len {
            return Ok(ToolResult {
                success: false,
                output: format!("Event not found: {id}"),
                metadata: None,
            });
        }

        self.save_events(&events).await?;

        Ok(ToolResult {
            success: true,
            output: format!("Event {id} removed."),
            metadata: None,
        })
    }
}
