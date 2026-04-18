use std::sync::Arc;

use aura_os_core::AgentOrchestration;
use aura_os_store::SettingsStore;
use uuid::Uuid;

// Column-family name kept in the super_agent_* form for on-disk
// compatibility with previously-persisted records.
const CF_NAME: &str = "super_agent_orchestrations";

pub struct OrchestrationStore {
    store: Arc<SettingsStore>,
}

impl OrchestrationStore {
    pub fn new(store: Arc<SettingsStore>) -> Self {
        Self { store }
    }

    pub fn save(&self, orch: &AgentOrchestration) -> Result<(), String> {
        let key = orch.orchestration_id.to_string();
        let value = serde_json::to_vec(orch).map_err(|e| e.to_string())?;
        self.store
            .put_cf_bytes(CF_NAME, key.as_bytes(), &value)
            .map_err(|e| e.to_string())
    }

    pub fn get(&self, id: &Uuid) -> Result<Option<AgentOrchestration>, String> {
        let key = id.to_string();
        match self.store.get_cf_bytes(CF_NAME, key.as_bytes()) {
            Ok(Some(bytes)) => {
                let orch = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                Ok(Some(orch))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn list(&self) -> Result<Vec<AgentOrchestration>, String> {
        let mut results: Vec<AgentOrchestration> =
            self.store.scan_cf_all(CF_NAME).map_err(|e| e.to_string())?;
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(results)
    }
}
