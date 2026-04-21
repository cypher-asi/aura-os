use async_trait::async_trait;
use serde_json::json;

use aura_os_core::{Capability, ToolDomain};

use super::helpers::{network_get, network_post, require_network};
use super::{AgentTool, AgentToolContext, CapabilityRequirement, Surface, ToolResult};
use aura_os_agent_runtime::AgentRuntimeError;

// ---------------------------------------------------------------------------
// 1. GetCreditBalanceTool
// ---------------------------------------------------------------------------

pub struct GetCreditBalanceTool;

#[async_trait]
impl AgentTool for GetCreditBalanceTool {
    fn name(&self) -> &str {
        "get_credit_balance"
    }
    fn description(&self) -> &str {
        "Get the current credit balance for the organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Billing
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // TODO(tier-a): `get_credit_balance` is a read-only billing
        // peek; the canonical `ManageBilling` capability gates
        // mutations. Require it here as the conservative default —
        // downstream JWT auth still enforces org membership.
        &[CapabilityRequirement::Exact(Capability::ManageBilling)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID (uses context org if omitted)" }
            },
            "required": []
        })
    }

    async fn execute(
        &self,
        _input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let balance = ctx
            .billing_client
            .get_balance(&ctx.jwt)
            .await
            .map_err(|e| AgentRuntimeError::ToolError(format!("get_credit_balance: {e}")))?;

        Ok(ToolResult {
            content: json!({
                "balance_cents": balance.balance_cents,
                "balance_formatted": balance.balance_formatted,
                "plan": balance.plan
            }),
            is_error: false,
        })
    }
}

// ---------------------------------------------------------------------------
// 2. GetTransactionsTool
// ---------------------------------------------------------------------------

pub struct GetTransactionsTool;

#[async_trait]
impl AgentTool for GetTransactionsTool {
    fn name(&self) -> &str {
        "get_transactions"
    }
    fn description(&self) -> &str {
        "Get credit transaction history for an organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Billing
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::ManageBilling)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID (uses context org if omitted)" }
            },
            "required": []
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let org_id = input["org_id"].as_str().unwrap_or(&ctx.org_id);
        network_get(
            network,
            &format!("/api/orgs/{org_id}/credits/transactions"),
            &ctx.jwt,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 3. GetBillingAccountTool
// ---------------------------------------------------------------------------

pub struct GetBillingAccountTool;

#[async_trait]
impl AgentTool for GetBillingAccountTool {
    fn name(&self) -> &str {
        "get_billing_account"
    }
    fn description(&self) -> &str {
        "Get billing account details for an organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Billing
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::ManageBilling)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID (uses context org if omitted)" }
            },
            "required": []
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let org_id = input["org_id"].as_str().unwrap_or(&ctx.org_id);
        network_get(network, &format!("/api/orgs/{org_id}/account"), &ctx.jwt).await
    }
}

// ---------------------------------------------------------------------------
// 4. PurchaseCreditsTool
// ---------------------------------------------------------------------------

pub struct PurchaseCreditsTool;

#[async_trait]
impl AgentTool for PurchaseCreditsTool {
    fn name(&self) -> &str {
        "purchase_credits"
    }
    fn description(&self) -> &str {
        "Initiate a credit purchase checkout session for an organization"
    }
    fn domain(&self) -> ToolDomain {
        ToolDomain::Billing
    }
    fn surface(&self) -> Surface {
        Surface::OnDemand
    }
    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        &[CapabilityRequirement::Exact(Capability::ManageBilling)]
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": { "type": "string", "description": "Organization ID (uses context org if omitted)" },
                "amount_usd": { "type": "number", "description": "Amount to purchase in USD (e.g. 10.00)" }
            },
            "required": ["amount_usd"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        let network = require_network(ctx)?;
        let org_id = input["org_id"].as_str().unwrap_or(&ctx.org_id);
        let amount_usd = input["amount_usd"]
            .as_f64()
            .ok_or_else(|| AgentRuntimeError::ToolError("amount_usd is required".into()))?;
        let body = json!({ "amount_usd": amount_usd });
        network_post(
            network,
            &format!("/api/orgs/{org_id}/credits/checkout"),
            &ctx.jwt,
            &body,
        )
        .await
    }
}
