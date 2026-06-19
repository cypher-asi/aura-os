//! Swarm gateway integration: provisioning, recovery, and readiness polling
//! for remote (microVM) agents.

mod provision;
mod readiness;
mod recovery;

use aura_os_core::Agent;

pub(super) use provision::provision_remote_agent;
pub(super) use recovery::delete_swarm_agent;
pub(crate) use recovery::recover_remote_agent_pipeline;

/// Result of (re)provisioning a Swarm machine for an agent. Returned by both
/// the create-time provisioning path and the recovery pipeline so callers can
/// refresh their in-memory `Agent` projection in one shot.
pub(crate) struct ReprovisionedRemoteAgent {
    pub agent: Agent,
    pub status: String,
    #[allow(dead_code)]
    pub previous_vm_id: Option<String>,
}

/// Status of a freshly-provisioned Swarm agent. Internal to the swarm
/// submodules — callers use [`ReprovisionedRemoteAgent`] instead.
struct ProvisionedSwarmAgent {
    agent_id: String,
    vm_id: String,
    status: String,
}

/// Errors surfaced by [`readiness::wait_for_swarm_agent_ready`]. Kept private
/// to the swarm submodules; the recovery pipeline maps these to API errors.
///
/// `ErrorState` carries the optional swarm-supplied diagnostic so callers
/// (the recovery handler, the auto-recovery wrapper) can surface the actual
/// root cause -- e.g. an `Unschedulable` or `ImagePullBackOff` reason --
/// instead of a generic "entered error state" string.
enum SwarmAgentReadyError {
    Timeout,
    ErrorState(Option<String>),
    Transport(String),
    Parse(String),
}
