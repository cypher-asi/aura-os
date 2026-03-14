use crate::claude::ToolDefinition;
use crate::tools::chat_tool_definitions;

/// Returns the full set of tools the chat agent can invoke.
pub fn agent_tool_definitions() -> Vec<ToolDefinition> {
    chat_tool_definitions()
}
