# Capabilities And Credentials Architecture

This is the canonical reference for the current Aura OS architecture around:
- capabilities
- credentials
- runtime state
- harness authorization

If nearby docs drift, follow this document.

## Terms

### Capabilities

Capabilities are the first-class add-ons Aura can install, authorize, expose, and audit.

They include:
- tools
- skills
- integrations

### Credentials

Credentials are auth material and connection secrets.

They include:
- provider API keys
- integration secrets
- runtime auth/config

The canonical authority for persisted org-level credentials is `aura-integrations`.
Aura OS may still retain compatibility-only local fallback paths while the migration is incomplete, but those are not the target architecture.

### Workspace / Runtime State

These are not first-class capabilities:
- projects
- specs
- tasks
- processes

They are workspace or runtime state.

## Current Model

- `aura-integrations` owns canonical persistence and retrieval for org-level credentials and integration secrets.
- Aura OS is the source of truth for capability definitions, integration catalog state, enablement, projection, and brokering.
- The harness does not own org secrets or config.
- Aura agents receive authorized capabilities at runtime through the harness session.
- External adapters receive the same capability surface through MCP projection.
- Trusted integration calls may still be brokered by Aura OS, but the harness remains the runtime authorization and execution boundary.

In simple terms:
- `aura-integrations` owns secrets
- Aura OS owns the control plane and secret broker role
- the harness owns runtime authorization and execution
- external adapters consume the same surface through MCP

## What The Harness Should Own

The harness should be the runtime permission layer.

That means it should own:
- installed capability state for the session or runtime
- authorization to use those capabilities
- auditability of capability usage

That does not require the harness to own:
- raw org secrets
- integration config storage
- provider credential persistence

## What Aura OS Should Own

Aura OS should continue to own:
- capability definitions
- integration schemas
- integration catalog and enablement state
- validation
- projection into installed integrations and installed tools
- provider dispatch and brokering for trusted integrations
- central policy and audit records

## What `aura-integrations` Should Own

`aura-integrations` should own:
- org-level credential persistence
- integration secret encryption and decryption
- canonical secret retrieval APIs
- secret metadata such as `has_secret` and `secret_last4`

## Security Boundary

The intended security split is:
- credentials stay in `aura-integrations`
- Aura OS retrieves or brokers secrets only when needed for authorized runtime work
- capabilities are authorized into the harness/runtime
- the harness uses only officially registered, authorized capabilities
- runtime calls remain auditable

Session injection is not inherently insecure if it is:
- registry-backed
- policy-checked
- authorized
- auditable

The important rule is not "nothing can be injected."
The important rule is "nothing arbitrary can be injected."

## Direction We Agreed On

Near-term direction:
- keep credential authority in `aura-integrations`
- keep any Aura OS local secret storage path explicitly marked as compatibility-only
- make integrations first-class installed capabilities in the harness/runtime model
- treat capability install or enable changes as policy-enforced state changes
- use the same capability model for Aura agents, workflows/processes, and future swarm-native flows

Examples of auditable state changes:
- Tool A installed
- Skill B installed
- Integration C installed

## Avoiding Duplication

We should not define integrations twice.

Avoid:
- one registry in Aura OS
- another separate registry in the harness

Prefer:
- one canonical capability model in Aura OS
- one canonical credential authority in `aura-integrations`
- one runtime-installed capability model in the harness
- one projection of that same model to external adapters through MCP

## Current Versus Next

Current:
- Aura OS owns the integration registry, catalog state, and capability projection
- `aura-integrations` is the canonical secret authority when configured
- Aura OS sends integrations into Aura sessions as installed integrations
- app integrations and MCP servers now have explicit `enabled` capability state
- integration-backed tools declare a typed required integration contract
- the harness can use them in the loop
- the harness only exposes integration-backed tools when the matching integration is installed
- trusted integration dispatch may still go back through Aura OS
- compatibility-only local fallback paths may still exist when `AURA_INTEGRATIONS_URL` is unset

Next:
- keep credentials in `aura-integrations`
- route install and enable state through policy enforcement
- make installed capability state feel more like true harness-owned runtime state
- extend the same installed integration model to workflows and processes
- make capability state and usage auditable across agents and workflows
