# Cross-project agent switching and recorded desktop skills

- Date: `2026-08-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.791.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.791.1

Today's nightly focuses on making agents more portable across projects and turning short desktop demonstrations into reusable, parameterized skills. Two substantial Interface changes landed together, extending both the chat surface and the agent skills workflow.

## 1:45 PM — Agent project switching and Skill Recorder for desktop workflows

The agent chat surface gained a project switcher across an agent's installed projects, and a new Skill Recorder turns a short screenshot demonstration into a reusable, parameterized skill draft.

- Agents installed in multiple projects can now be switched between directly from the chat input's project picker: a new use-agent-project-bindings hook discovers every project binding for an agent, deduplicates to one routable binding per project, and wires the picker to navigate to the matching project/agent route. Discovery failures are non-fatal, so the current project stays visible even when lookup fails. (`d619a7d`)
- A new Skill Recorder modal in the agent Skills tab lets users capture a short visual demonstration plus a stated goal and generates a SKILL.md draft (name, description, body) via a dedicated harness-proxy endpoint. The server-side analyzer prompts the model to generalize screenshots into parameterized instructions with prerequisites, verification, and privacy cautions rather than brittle coordinates. (`283ae0f`)
- The recorded-skill router path is hardened with explicit request limits — up to 12 frames, 3 MB per frame, 20 MB total, 1,000-character goals, and 4,000-character notes — and routed through the trusted router with agent-scoped headers, so uploads can't overwhelm the analyzer. (`283ae0f`)

## Highlights

- Agents can now hop between the projects they're installed in from the chat input
- New Skill Recorder turns a short desktop demo into a generated SKILL.md draft

