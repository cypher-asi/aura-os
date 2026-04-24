//! Core `AgentTool` trait, `CapabilityRequirement`, `ToolRegistry`,
//! and `AgentToolContext` — the surface every concrete tool impl
//! is written against.
//!
//! Concrete `impl AgentTool for X` blocks and the registry builders
//! live in the peer crate `aura-os-agent-tools` (split out in Tier D
//! of the architectural review). Callers that want the shared
//! tier1/tier2 registry should use `aura_os_agent_tools::shared_all_tools_registry()`;
//! this crate has no opinion on which tools exist.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_billing::BillingClient;
use aura_os_core::{Capability, ToolDomain};
use aura_os_link::AutomatonClient;
use aura_os_network::{NetworkClient, OrbitClient};
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::SettingsStore;
use aura_os_tasks::TaskService;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub content: serde_json::Value,
    #[serde(default)]
    pub is_error: bool,
}

/// Declarative *session inclusion policy* for a tool.
///
/// Orthogonal to [`AgentTool::required_capabilities`] (which governs
/// *access*). `Surface` was originally intended to split tools into
/// "ship by default" and "ship only after the LLM promotes their
/// domain via `load_domain_tools`" tiers. That surface gate has been
/// removed — every tool whose `required_capabilities()` the agent
/// satisfies now ships in the default session payload — so the enum
/// is retained only so per-tool declarations compile; the value is
/// not consulted by the session assembler.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Surface {
    /// Ship the tool in every session whose agent's
    /// [`AgentPermissions`] satisfy `required_capabilities()`. This
    /// is effectively the only variant honored today.
    Always,
    /// Legacy variant — previously hid the tool behind a
    /// `load_domain_tools` promotion step. Treated identically to
    /// `Always` by the session assembler.
    OnDemand,
}

impl Default for Surface {
    fn default() -> Self {
        Self::Always
    }
}

/// A capability requirement declared by an [`AgentTool`].
///
/// Some tools need a fixed capability (e.g. `spawn_agent` always needs
/// [`Capability::SpawnAgent`]); others need a scope-qualified capability
/// whose target id only becomes known at call time from the tool
/// arguments (e.g. `get_project` needs
/// [`Capability::ReadProject { id }`] where `id` is `args["project_id"]`).
/// The `*FromArg` variants defer the resolution to
/// [`CapabilityRequirement::resolve`] so [`AgentTool::required_capabilities`]
/// can stay `'static` while still supporting per-call scoping.
#[derive(Debug, Clone)]
pub enum CapabilityRequirement {
    /// Tool requires the agent to hold this exact capability (unscoped).
    Exact(Capability),
    /// Tool requires `ReadProject { id }` where `id` comes from
    /// `args[arg_key]` as a string.
    ReadProjectFromArg(&'static str),
    /// Tool requires `WriteProject { id }` where `id` comes from
    /// `args[arg_key]` as a string.
    WriteProjectFromArg(&'static str),
    /// Tool requires any of these capabilities (OR semantics).
    ///
    /// Policy is currently AND-over-requirements, so a single
    /// `AnyOf` requirement expands to a synthetic capability matched by
    /// the policy layer's "any overlap" check; see
    /// `aura_os_agent_runtime::policy::check_capabilities`.
    AnyOf(&'static [Capability]),
}

impl CapabilityRequirement {
    /// Resolve the concrete capabilities this requirement produces, given
    /// runtime `args`. `ReadProjectFromArg` / `WriteProjectFromArg` look
    /// up the named string argument; missing / non-string values produce
    /// an empty vec (the tool's own argument validation will surface the
    /// real error to the caller). `AnyOf` produces one synthetic
    /// [`Capability::ReadProject`] placeholder per member so the policy
    /// layer can iterate; the policy layer special-cases `AnyOf` via
    /// [`Self::any_of_members`].
    pub fn resolve(&self, args: &serde_json::Value) -> Vec<Capability> {
        match self {
            CapabilityRequirement::Exact(cap) => vec![cap.clone()],
            CapabilityRequirement::ReadProjectFromArg(key) => args
                .get(*key)
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| vec![Capability::ReadProject { id: s.to_string() }])
                .unwrap_or_default(),
            CapabilityRequirement::WriteProjectFromArg(key) => args
                .get(*key)
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| vec![Capability::WriteProject { id: s.to_string() }])
                .unwrap_or_default(),
            CapabilityRequirement::AnyOf(caps) => caps.to_vec(),
        }
    }
}

#[async_trait]
pub trait AgentTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn domain(&self) -> ToolDomain;
    fn parameters_schema(&self) -> serde_json::Value;
    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, crate::AgentRuntimeError>;

    /// Capabilities the calling agent must possess for this tool to be
    /// executable. The dispatcher enforces this via
    /// `aura_os_agent_runtime::policy::check_capabilities` before
    /// invoking [`Self::execute`]. Return an empty slice for tools that
    /// require no special capability (always allowed).
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[]
    }

    /// `true` iff the tool's JSON arguments should stream eagerly to
    /// the client via Anthropic's `input_json_delta`. The default is
    /// `false`; only tools producing substantial markdown / file
    /// content (e.g. `create_spec`, `update_spec`) should override.
    ///
    /// The canonical list of streaming tools is assembled by
    /// `aura_os_agent_tools::streaming_tool_names` from this trait method
    /// plus the harness-side file tools in
    /// `aura_os_agent_templates::HARNESS_SIDE_STREAMING_TOOL_NAMES`.
    fn is_streaming(&self) -> bool {
        false
    }

    /// Session inclusion policy. Defaults to [`Surface::Always`] —
    /// every tool the agent has the capabilities for is shipped in
    /// the default session payload. Individual tools may still
    /// override to [`Surface::OnDemand`] for backwards compatibility
    /// with older declarations; both variants are treated identically
    /// by the session assembler (see `aura_os_agent_tools::session`).
    fn surface(&self) -> Surface {
        Surface::Always
    }

    /// Resolve concrete capability requirements given the runtime
    /// arguments. Default impl flattens [`Self::required_capabilities`]
    /// via [`CapabilityRequirement::resolve`]; tools that need more
    /// exotic arg-dependent scoping can override.
    fn resolve_required_capabilities(&self, args: &serde_json::Value) -> Vec<Capability> {
        self.required_capabilities()
            .iter()
            .flat_map(|req| req.resolve(args))
            .collect()
    }
}

pub struct AgentToolContext {
    pub user_id: String,
    pub org_id: String,
    pub jwt: String,
    pub project_service: Arc<ProjectService>,
    pub agent_service: Arc<AgentService>,
    pub agent_instance_service: Arc<AgentInstanceService>,
    pub task_service: Arc<TaskService>,
    pub session_service: Arc<SessionService>,
    pub org_service: Arc<OrgService>,
    pub billing_client: Arc<BillingClient>,
    pub automaton_client: Arc<AutomatonClient>,
    pub network_client: Option<Arc<NetworkClient>>,
    pub storage_client: Option<Arc<StorageClient>>,
    pub orbit_client: Option<Arc<OrbitClient>>,
    pub store: Arc<SettingsStore>,
    pub event_broadcast: broadcast::Sender<serde_json::Value>,
    /// Base URL (no trailing slash) of the aura-os-server instance running in
    /// this process. When set, tools that need server-side side-effects
    /// (e.g. spec disk mirrors) should POST/PUT/DELETE here instead of going
    /// directly to the remote router via `network_client`.
    pub local_server_base_url: Option<String>,
    /// HTTP client reused for local-server calls. Shared with `AgentRuntimeService`.
    pub local_http_client: reqwest::Client,
}

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn AgentTool>>,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: Arc<dyn AgentTool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub fn get(&self, name: &str) -> Option<&Arc<dyn AgentTool>> {
        self.tools.get(name)
    }

    pub fn list_tools(&self) -> Vec<&Arc<dyn AgentTool>> {
        self.tools.values().collect()
    }

    /// Names of every tool currently in this registry.
    pub fn tool_names(&self) -> Vec<String> {
        self.tools.keys().cloned().collect()
    }

    pub fn tools_for_domains(&self, domains: &[ToolDomain]) -> Vec<&Arc<dyn AgentTool>> {
        self.tools
            .values()
            .filter(|t| domains.contains(&t.domain()))
            .collect()
    }

    pub fn tool_definitions(&self, tools: &[&Arc<dyn AgentTool>]) -> Vec<serde_json::Value> {
        tools
            .iter()
            .map(|t| {
                let mut def = serde_json::json!({
                    "name": t.name(),
                    "description": t.description(),
                    "input_schema": t.parameters_schema(),
                });
                // Opt the tool into Anthropic's fine-grained tool streaming
                // (`input_json_delta`) so the UI can render `markdown_contents`
                // / file `content` character-by-character in the preview card
                // rather than in one batch at the end of the turn. Harness-side
                // file tools (`write_file`, `edit_file`) are not in this
                // registry and are surfaced via
                // `aura_os_agent_templates::HARNESS_SIDE_STREAMING_TOOL_NAMES`.
                if t.is_streaming() {
                    def["eager_input_streaming"] = serde_json::Value::Bool(true);
                }
                def
            })
            .collect()
    }
}
