use std::sync::Arc;

use tokio::sync::mpsc;
use tracing::{error, info};

use aura_billing::MeteredLlm;
use aura_claude::ClaudeStreamEvent;
use aura_core::Sprint;
use aura_store::RocksStore;

use aura_core::SPRINT_SYSTEM_PROMPT;
use crate::SpecGenError;

const SPRINT_MAX_TOKENS: u32 = 8192;

pub struct SprintGenerationService {
    llm: Arc<MeteredLlm>,
    store: Arc<RocksStore>,
}

impl SprintGenerationService {
    pub fn new(llm: Arc<MeteredLlm>, store: Arc<RocksStore>) -> Self {
        Self { llm, store }
    }

    /// Generate expanded requirements from a sprint's prompt (non-streaming).
    /// Updates the sprint in the store and returns the updated sprint.
    pub async fn generate(
        &self,
        api_key: &str,
        mut sprint: Sprint,
    ) -> Result<Sprint, SpecGenError> {
        let resp = self
            .llm
            .complete_with_model(
                aura_claude::MID_MODEL,
                api_key,
                SPRINT_SYSTEM_PROMPT,
                &sprint.prompt,
                SPRINT_MAX_TOKENS,
                "aura_sprint_gen",
                None,
            )
            .await?;

        sprint.prompt = resp.text;
        sprint.generated_at = Some(chrono::Utc::now());
        sprint.updated_at = chrono::Utc::now();

        self.store.put_sprint(&sprint)?;

        info!(
            sprint_id = %sprint.sprint_id,
            project_id = %sprint.project_id,
            "Sprint generated via LLM"
        );
        Ok(sprint)
    }

    /// Generate expanded requirements with streaming deltas.
    /// Sends `ClaudeStreamEvent` deltas to `event_tx`, persists the result,
    /// and returns the updated sprint or an error.
    pub async fn generate_stream(
        &self,
        api_key: &str,
        mut sprint: Sprint,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<Sprint, SpecGenError> {
        let full_text = self
            .llm
            .complete_stream(
                api_key,
                SPRINT_SYSTEM_PROMPT,
                &sprint.prompt,
                SPRINT_MAX_TOKENS,
                event_tx,
                "aura_sprint_gen",
                None,
            )
            .await?;

        sprint.prompt = full_text;
        sprint.generated_at = Some(chrono::Utc::now());
        sprint.updated_at = chrono::Utc::now();

        self.store.put_sprint(&sprint).map_err(|e| {
            error!(sprint_id = %sprint.sprint_id, error = %e, "Failed to save generated sprint");
            e
        })?;

        info!(
            sprint_id = %sprint.sprint_id,
            project_id = %sprint.project_id,
            "Sprint generated via streaming LLM"
        );
        Ok(sprint)
    }
}
