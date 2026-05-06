use std::path::Path;

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// A single routing rule mapping a pattern to target agents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRule {
    /// Pattern to match (keywords, glob-style, or regex)
    pub pattern: String,
    /// Agent names to route to when pattern matches
    pub agents: Vec<String>,
    /// Priority (higher = matched first)
    pub priority: u32,
    /// Description of what this rule handles
    pub description: Option<String>,
}

/// Result of routing a message.
#[derive(Debug, Clone)]
pub struct RoutingDecision {
    /// Target agent(s)
    pub agents: Vec<String>,
    /// How the decision was made
    pub strategy: RoutingStrategy,
    /// Why this decision was made
    pub rationale: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RoutingStrategy {
    /// Direct @mention in message
    DirectMention,
    /// Matched a routing rule pattern
    PatternMatch,
    /// No rules matched, using default agent
    DefaultFallback,
    /// Route to all agents (parallel fan-out)
    FanOut,
}

pub struct Router {
    rules: Vec<RoutingRule>,
    default_agent: Option<String>,
}

impl Router {
    /// Create a new router with no rules.
    pub fn new() -> Self {
        Self {
            rules: Vec::new(),
            default_agent: None,
        }
    }

    /// Load routing rules from a routing.md file.
    /// Format: markdown with a table listing rules.
    pub fn load_from_file(path: &Path) -> Result<Self> {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return Ok(Self::new()),
        };

        if content.trim().is_empty() {
            return Ok(Self::new());
        }

        let mut router = Self::new();

        // Parse markdown table rows
        for line in content.lines() {
            let trimmed = line.trim();

            // Skip header rows, separator rows, and non-table lines
            if !trimmed.starts_with('|') || trimmed.contains("---") {
                continue;
            }

            let columns: Vec<&str> = trimmed
                .split('|')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();

            // Need at least pattern and agents columns
            if columns.len() < 2 {
                continue;
            }

            // Skip the header row
            let pattern_col = columns[0].to_lowercase();
            if pattern_col == "pattern" {
                continue;
            }

            let pattern = columns[0].trim().to_string();
            let agents: Vec<String> = columns[1]
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();

            let priority = columns
                .get(2)
                .and_then(|s| s.trim().parse::<u32>().ok())
                .unwrap_or(5);

            let description = columns.get(3).map(|s| s.trim().to_string());

            if !pattern.is_empty() && !agents.is_empty() {
                router.add_rule(RoutingRule {
                    pattern,
                    agents,
                    priority,
                    description,
                });
            }
        }

        Ok(router)
    }

    /// Add a rule programmatically.
    pub fn add_rule(&mut self, rule: RoutingRule) {
        self.rules.push(rule);
        // Keep rules sorted by priority descending
        self.rules.sort_by_key(|r| std::cmp::Reverse(r.priority));
    }

    /// Set the default agent for when no rules match.
    pub fn set_default_agent(&mut self, agent: impl Into<String>) {
        self.default_agent = Some(agent.into());
    }

    /// Route a message to appropriate agent(s).
    pub fn route(&self, message: &str) -> RoutingDecision {
        let lower = message.to_lowercase();

        // 1. Check for @mentions
        let mentions: Vec<String> = message
            .split_whitespace()
            .filter(|w| w.starts_with('@') && w.len() > 1)
            .map(|w| {
                w[1..]
                    .trim_end_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
                    .to_string()
            })
            .filter(|s| !s.is_empty())
            .collect();

        if !mentions.is_empty() {
            return RoutingDecision {
                agents: mentions.clone(),
                strategy: RoutingStrategy::DirectMention,
                rationale: format!("Direct @mention of: {}", mentions.join(", ")),
            };
        }

        // 2. Check for fan-out keywords
        let fan_out_keywords = ["@team", "@all", "@everyone"];
        if fan_out_keywords.iter().any(|kw| lower.contains(kw))
            || lower
                .split_whitespace()
                .any(|w| w == "team" || w == "all" || w == "everyone")
        {
            let all_agents: Vec<String> = self
                .rules
                .iter()
                .flat_map(|r| r.agents.iter().cloned())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();

            if !all_agents.is_empty() {
                return RoutingDecision {
                    agents: all_agents,
                    strategy: RoutingStrategy::FanOut,
                    rationale: "Message targets all agents (fan-out keyword detected)".to_string(),
                };
            }
        }

        // 3. Match against rules by priority (already sorted descending)
        for rule in &self.rules {
            let keywords: Vec<&str> = rule.pattern.split(',').map(|s| s.trim()).collect();
            if keywords.iter().any(|kw| lower.contains(&kw.to_lowercase())) {
                return RoutingDecision {
                    agents: rule.agents.clone(),
                    strategy: RoutingStrategy::PatternMatch,
                    rationale: format!(
                        "Matched rule pattern '{}' (priority {})",
                        rule.pattern, rule.priority
                    ),
                };
            }
        }

        // 4. Default fallback
        let fallback = self
            .default_agent
            .clone()
            .map(|a| vec![a])
            .or_else(|| self.rules.first().map(|r| r.agents.clone()))
            .unwrap_or_default();

        RoutingDecision {
            agents: fallback,
            strategy: RoutingStrategy::DefaultFallback,
            rationale: "No rules matched, using default agent".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_direct_mention() {
        let router = Router::new();
        let decision = router.route("Hey @frontend-dev can you fix this?");
        assert_eq!(decision.strategy, RoutingStrategy::DirectMention);
        assert_eq!(decision.agents, vec!["frontend-dev"]);
    }

    #[test]
    fn test_fan_out() {
        let mut router = Router::new();
        router.add_rule(RoutingRule {
            pattern: "frontend".to_string(),
            agents: vec!["frontend-dev".to_string()],
            priority: 10,
            description: None,
        });
        router.add_rule(RoutingRule {
            pattern: "backend".to_string(),
            agents: vec!["backend-dev".to_string()],
            priority: 10,
            description: None,
        });

        let decision = router.route("team please review this");
        assert_eq!(decision.strategy, RoutingStrategy::FanOut);
        assert!(decision.agents.contains(&"frontend-dev".to_string()));
        assert!(decision.agents.contains(&"backend-dev".to_string()));
    }

    #[test]
    fn test_pattern_match() {
        let mut router = Router::new();
        router.add_rule(RoutingRule {
            pattern: "frontend, ui, css, react".to_string(),
            agents: vec!["frontend-dev".to_string()],
            priority: 10,
            description: Some("Frontend work".to_string()),
        });

        let decision = router.route("Fix the CSS on the landing page");
        assert_eq!(decision.strategy, RoutingStrategy::PatternMatch);
        assert_eq!(decision.agents, vec!["frontend-dev"]);
    }

    #[test]
    fn test_priority_ordering() {
        let mut router = Router::new();
        router.add_rule(RoutingRule {
            pattern: "api".to_string(),
            agents: vec!["backend-dev".to_string()],
            priority: 5,
            description: None,
        });
        router.add_rule(RoutingRule {
            pattern: "api, security".to_string(),
            agents: vec!["security-specialist".to_string()],
            priority: 9,
            description: None,
        });

        let decision = router.route("Check the api for vulnerabilities");
        assert_eq!(decision.agents, vec!["security-specialist"]);
    }

    #[test]
    fn test_default_fallback() {
        let mut router = Router::new();
        router.set_default_agent("general-assistant");

        let decision = router.route("What is the meaning of life?");
        assert_eq!(decision.strategy, RoutingStrategy::DefaultFallback);
        assert_eq!(decision.agents, vec!["general-assistant"]);
    }

    #[test]
    fn test_load_empty_file() {
        let path = Path::new("nonexistent_routing.md");
        let router = Router::load_from_file(path).unwrap();
        assert_eq!(router.rules.len(), 0);
    }
}
