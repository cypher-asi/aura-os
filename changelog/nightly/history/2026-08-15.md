# Agents get side questions, recorded skills, and project hopping

- Date: `2026-08-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.792.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.792.1

Today's nightly is an agent-experience release. Agents can now be moved between projects from the chat surface, desktop workflows can be captured as reusable skills from a short screen recording, and a new ephemeral /btw command lets you ask a one-off side question without polluting the main conversation. Server-side changes tighten how credentialed storage and router requests are validated.

## 1:45 PM — Agent project switching, recorded skills, and /btw asides

A focused afternoon of agent-surface features: cross-project agent navigation, a skill recorder that turns demonstrations into SKILL.md drafts, and an ephemeral side-question command backed by hardened storage and router paths.

- Agents installed in more than one project can now be moved between them from the chat input's project picker, powered by a new bindings hook that dedupes to one routable entry per project and fails quietly when discovery is unavailable. (`d619a7d`)
- A new Skill Recorder in the agent info panel turns a short desktop demonstration into a reusable skill: up to 12 frames are sent through a trusted router path to an analysis model that returns a kebab-case name, description, and Markdown SKILL.md body, with bounded frame and payload sizes to keep requests safe. (`283ae0f`)
- New /btw command opens an Aside modal from the chat input (desktop and mobile) to ask a one-off, ephemeral question against the current session's context — answers are concise, do not call tools, and are never appended to the main conversation. (`b9bb749`)
- Storage and router plumbing behind the aside and skill-recorder endpoints was tightened: credentialed service requests are now gated behind validated inputs, storage requests execute locally against verified sessions, and response bodies are bounded to prevent oversized replies. (`b9bb749`, `283ae0f`)

## Highlights

- Switch an agent's project directly from chat
- Turn a screen recording into a reusable skill
- Ephemeral /btw side questions in any session

