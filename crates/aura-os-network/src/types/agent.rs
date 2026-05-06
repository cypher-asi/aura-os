use aura_os_core::{AgentPermissions, IntentClassifierSpec, ProfileId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAgent {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub personality: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub skills: Option<Vec<String>>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub harness: Option<String>,
    #[serde(default)]
    pub machine_type: Option<String>,
    #[serde(default)]
    pub vm_id: Option<String>,
    #[serde(alias = "ownerId")]
    pub user_id: String,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Marketplace listing status. Serialized as `"closed"` / `"hireable"`;
    /// absent on older records, so the server treats `None` as "closed".
    ///
    /// Aliases the snake_case key as a defensive measure: the struct's
    /// `rename_all = "camelCase"` makes `listingStatus` the canonical wire
    /// name, but the migration doc and some upstream fixtures emit
    /// `listing_status`. Without the alias those rows would deserialize
    /// with `None` and `derive_listing_status` would silently fall back to
    /// `Closed`, hiding hireable agents from the marketplace.
    #[serde(default, alias = "listing_status")]
    pub listing_status: Option<String>,
    /// Marketplace expertise slugs.
    #[serde(default)]
    pub expertise: Option<Vec<String>>,
    /// Aggregated marketplace stats. Computed server-side.
    #[serde(default)]
    pub jobs: Option<u64>,
    /// Aliases the snake_case key for the same reason as `listing_status`.
    #[serde(default, alias = "revenue_usd")]
    pub revenue_usd: Option<f64>,
    #[serde(default)]
    pub reputation: Option<f32>,
    /// Required capability + scope bundle for this agent. Defaults to
    /// empty when older aura-network records don't include it.
    #[serde(default)]
    pub permissions: AgentPermissions,
    /// Optional keyword-driven intent classifier. Populated for CEO
    /// bootstraps; `None` for regular agents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent_classifier: Option<IntentClassifierSpec>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

impl NetworkAgent {
    pub fn profile_id_typed(&self) -> Option<ProfileId> {
        self.profile_id
            .as_ref()?
            .parse()
            .ok()
            .map(ProfileId::from_uuid)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub machine_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Marketplace listing status. Accepts `"closed"` or `"hireable"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listing_status: Option<String>,
    /// Marketplace expertise slugs. Unknown slugs are rejected server-side.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expertise: Option<Vec<String>>,
    /// Required capability + scope bundle for this agent.
    pub permissions: AgentPermissions,
    /// Optional intent classifier spec.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent_classifier: Option<IntentClassifierSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub machine_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vm_id: Option<String>,
    /// `None` means "don't change"; `Some(vec)` replaces the tag set wholesale.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Marketplace listing status. Accepts `"closed"` or `"hireable"`.
    /// `None` leaves the server value untouched.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listing_status: Option<String>,
    /// Replaces the marketplace expertise set wholesale. `None` leaves it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expertise: Option<Vec<String>>,
    /// Optional new permissions bundle. `None` leaves the server copy
    /// untouched.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<AgentPermissions>,
    /// Optional new intent classifier. `None` leaves the server copy
    /// untouched.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent_classifier: Option<IntentClassifierSpec>,
}
