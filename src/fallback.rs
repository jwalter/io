use anyhow::Result;

/// Tier of models ordered by capability/cost.
#[derive(Debug, Clone)]
pub struct ModelChain {
    pub tier_name: String,
    pub models: Vec<String>,
}

/// Manages model selection with fallback on failure.
pub struct ModelSelector {
    chains: Vec<ModelChain>,
    default_model: String,
}

impl ModelSelector {
    pub fn new(default_model: String, fallback_chain: Vec<String>) -> Self {
        let chains = vec![
            ModelChain {
                tier_name: "premium".to_string(),
                models: vec!["claude-opus-4-5".to_string(), "gpt-5.2".to_string()],
            },
            ModelChain {
                tier_name: "standard".to_string(),
                models: fallback_chain,
            },
            ModelChain {
                tier_name: "fast".to_string(),
                models: vec!["claude-haiku-4-5".to_string(), "gpt-4.1".to_string()],
            },
        ];
        Self {
            chains,
            default_model,
        }
    }

    /// Get the default model.
    pub fn default_model(&self) -> &str {
        &self.default_model
    }

    /// Get the fallback chain for a tier.
    pub fn chain_for_tier(&self, tier: &str) -> Option<&[String]> {
        self.chains
            .iter()
            .find(|c| c.tier_name == tier)
            .map(|c| c.models.as_slice())
    }

    /// Try models in order until one succeeds. Returns the model that worked.
    pub async fn try_with_fallback<F, Fut, T>(
        &self,
        tier: &str,
        mut attempt: F,
    ) -> Result<(String, T)>
    where
        F: FnMut(&str) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let models = self
            .chain_for_tier(tier)
            .unwrap_or(std::slice::from_ref(&self.default_model));

        let mut last_err = None;
        for model in models {
            match attempt(model).await {
                Ok(result) => {
                    tracing::info!(model = %model, tier = %tier, "Model succeeded");
                    return Ok((model.clone(), result));
                }
                Err(e) => {
                    tracing::warn!(model = %model, error = %e, "Model failed, trying next");
                    last_err = Some(e);
                }
            }
        }

        Err(last_err.unwrap_or_else(|| anyhow::anyhow!("No models available in tier: {}", tier)))
    }
}
