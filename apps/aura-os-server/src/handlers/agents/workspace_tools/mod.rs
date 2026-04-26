mod catalog;
mod integrations;
mod runtime;
mod secrets;
mod trusted_mcp;
mod types;

#[cfg(test)]
mod tests;

use aura_os_integrations::control_plane_api_base_url as shared_control_plane_api_base_url;

pub(crate) use catalog::{
    installed_workspace_app_tool_catalog, installed_workspace_app_tools,
    installed_workspace_app_tools_with_integrations,
};
pub(crate) use integrations::{
    installed_workspace_integrations_for_org_with_token,
    installed_workspace_integrations_with_integrations, integrations_for_org,
    integrations_for_org_with_token,
};

#[cfg(test)]
pub(crate) use integrations::installed_workspace_integrations_for_org;

pub(crate) fn control_plane_api_base_url() -> String {
    shared_control_plane_api_base_url()
}
