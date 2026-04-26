use aura_os_harness::InstalledTool;

#[derive(Clone, Debug)]
pub(crate) struct InstalledWorkspaceToolCatalog {
    pub(crate) tools: Vec<InstalledTool>,
    pub(crate) warnings: Vec<InstalledWorkspaceToolWarning>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InstalledWorkspaceToolWarning {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) detail: String,
    pub(crate) source_kind: String,
    pub(crate) trust_class: String,
    pub(crate) integration_id: String,
    pub(crate) integration_name: String,
    pub(crate) provider: String,
}
