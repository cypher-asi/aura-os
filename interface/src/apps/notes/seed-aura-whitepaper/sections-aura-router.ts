/**
 * Whitepaper sections for the aura-router repo (cypher-asi/aura-router): the
 * platform's LLM proxy and billing gateway. Authored from the repo README and
 * docs/api.md. Grouped under the "aura-router" nav key; sortOrder band 200+.
 */

import { F, type WhitepaperSection } from "./sections-types";

export const AURA_ROUTER_SECTIONS: WhitepaperSection[] = [
  {
    title: "Overview",
    slug: "aura-router-overview",
    section: "aura-router",
    sortOrder: 200,
    excerpt:
      "The platform's LLM proxy and billing gateway: auth, credit enforcement, provider routing, and usage recording for every LLM request.",
    body: `# Overview

AURA Router is the platform's LLM proxy and billing gateway. Every client LLM request flows through it for authentication, credit enforcement, provider routing, and usage recording — the platform API keys never reach the client.

## Overview

- Single ingress for all LLM traffic (desktop, web, mobile) via the Anthropic-compatible \`POST /v1/messages\`.
- JWT auth (Auth0 RS256 + HS256 shared secret) and per-user sliding-window rate limiting.
- Synchronous credit pre-check against \`z-billing\`, then fire-and-forget debit, usage, and event recording.
- Provider routing by model prefix to Anthropic / OpenAI using platform-held keys the client never sees.
- Media generation: images (OpenAI, Gemini) and 3D (Tripo), with S3 + \`aura-storage\` artifact storage.

## Architecture

${F}text
 Client (desktop / web / mobile)
   |  JWT + Anthropic-format request
   v
 aura-router
   |  1 validate JWT       2 rate limit
   |  3 parse model        4 resolve provider
   |  5 credit pre-check (z-billing, sync)
   |  6 forward with platform key
   v
 LLM provider (api.anthropic.com / api.openai.com)
   |  response streamed / returned to client
   |  then background: 8 debit · 9 usage · 10 events
${F}

## Internals

The only synchronous dependency is the credit pre-check; everything after the response is fire-and-forget so recording never blocks or fails the proxied call.

${F}text
 request --> [ sync ] credit pre-check --> z-billing   (blocks; 402 if low)
         --> forward to provider --> client response
         --> [ background, fire-and-forget ]
                +--> z-billing    POST /v1/usage         (debit actual cost)
                +--> aura-network POST /internal/usage   (stats)
                +--> aura-storage POST /internal/events  (session events, if X-Aura-* headers)
${F}

The service is a Rust Axum app split into \`core\` (types/errors), \`auth\` (JWT/JWKS), \`domain/proxy\` (providers, billing, S3, streaming), and \`server\` (handlers + middleware). Platform secrets (\`ANTHROPIC_API_KEY\`, \`OPENAI_API_KEY\`, \`Z_BILLING_API_KEY\`) live only on the server.`,
  },
  {
    title: "Authentication & Rate Limiting",
    slug: "aura-router-auth",
    section: "aura-router",
    sortOrder: 201,
    excerpt:
      "Dual JWT validation (Auth0 RS256 + HS256 shared secret) and per-user sliding-window rate limiting.",
    body: `# Authentication & Rate Limiting

Every proxy endpoint requires a bearer JWT; both Auth0 RS256 (JWKS) and HS256 (shared secret) tokens are accepted. Requests are throttled per user with a sliding window.

## Overview

- Dual JWT validation: RS256 via Auth0 JWKS, HS256 via \`AUTH_COOKIE_SECRET\` — the same tokens \`aura-network\` and \`aura-storage\` accept.
- Tokens are obtained via zOS login (\`POST /api/v2/accounts/login\`).
- Service-to-service calls authenticate with \`INTERNAL_SERVICE_TOKEN\`.
- Per-user sliding window, default 60 rpm (\`RATE_LIMIT_RPM\`); breaches return \`429\` with a \`Retry-After\` header.
- Invalid or missing tokens return \`401\`.

## Architecture

${F}text
 Authorization: Bearer <jwt>
        |
        v
   inspect alg
    |        |
  RS256     HS256
    |          |
 Auth0 JWKS   AUTH_COOKIE_SECRET
 (cached)        |
    |            |
    +-----+------+
          v
     valid? --no--> 401 UNAUTHORIZED
          |  yes
          v
   per-user rate window
${F}

## Internals

The rate limiter keeps a per-user sliding window of request timestamps; a request is admitted only if the count within the last 60s is below the limit, otherwise it is rejected with the seconds-to-wait surfaced in \`Retry-After\`.

${F}text
 user_id -> [ t-60s ............ now ]   window of recent request times
            count < RATE_LIMIT_RPM ? --yes--> admit
                                      --no---> 429 + Retry-After
${F}`,
  },
  {
    title: "LLM Proxy",
    slug: "aura-router-llm-proxy",
    section: "aura-router",
    sortOrder: 202,
    excerpt:
      "Anthropic-compatible POST /v1/messages: provider routing by model prefix, streaming + non-streaming, with context-window usage.",
    body: `# LLM Proxy

\`POST /v1/messages\` is an Anthropic-compatible proxy that forwards chat completions to the resolved provider with the platform key, returning streaming or non-streaming responses annotated with context-window usage.

## Overview

- Anthropic Messages API shape; unrecognized fields (\`top_p\`, \`top_k\`, \`tools\`, \`tool_choice\`, ...) are forwarded as-is.
- Provider routing by model prefix: \`claude-*\` to Anthropic; \`gpt-*\` / \`o1-*\` / \`o3-*\` / \`o4-*\` / \`codex-*\` to OpenAI.
- Non-streaming returns the provider JSON plus \`X-Context-Usage\` and \`X-Model-Max-Tokens\` headers.
- Streaming forwards the provider SSE then appends a custom \`x_context_usage\` event.
- 25 MB body limit (image content blocks); unsupported model prefix or unconfigured provider returns \`400\`.

## Architecture

${F}text
 POST /v1/messages
   |  validate JWT -> rate limit -> parse model
   v
 resolve provider by prefix
   claude-*                      gpt-* / o1-* / o3-* / o4-* / codex-*
      |                                       |
      v                                       v
 api.anthropic.com/v1/messages     api.openai.com/v1/chat/completions
      |                                       |
      +------------------+--------------------+
                         v
              response (+ context usage)
${F}

## Internals

For streaming, provider SSE chunks pass straight through to the client; the router accumulates token counts and emits a trailing \`x_context_usage\` event so the UI can render context-window pressure.

${F}text
 provider SSE: data: {...}\\n\\n  -->  forwarded verbatim to client
                ...
 data: [DONE]
   |  router computes inputTokens / maxTokens
   v
 event: x_context_usage
 data: { contextUsage, inputTokens, outputTokens, maxTokens }
${F}

\`X-Context-Usage\` is \`input_tokens / max_context_tokens\` for the resolved model; unsupported prefixes and (for OpenAI models) a missing \`OPENAI_API_KEY\` both yield \`400 BAD_REQUEST\`, an unreachable provider \`502 PROVIDER_ERROR\`.`,
  },
  {
    title: "Billing Integration",
    slug: "aura-router-billing",
    section: "aura-router",
    sortOrder: 203,
    excerpt:
      "Synchronous credit pre-check gates every request; the real token cost is debited asynchronously after the provider responds.",
    body: `# Billing Integration

The router is the enforcement point for credits: a synchronous pre-check gates every request, and the real cost is debited asynchronously once the provider responds.

## Overview

- Pre-check (\`POST /v1/usage/check\`, min 1 credit) blocks the request; \`402 INSUFFICIENT_CREDITS\` if low, \`503 BILLING_UNAVAILABLE\` if \`z-billing\` is down.
- Debit (\`POST /v1/usage\`) runs in the background with the actual token cost (fire-and-forget).
- Media generation bills a flat per-generation cost (images 7-26 credits; 3D 50 credits).
- Credits are Z Credits (1 = $0.01) owned by \`z-billing\`; the router only checks and reports.

## Architecture

${F}text
 request
   |  POST /v1/usage/check  (>= 1 credit) ----> z-billing
   |  <-- ok | 402 | 503
   v
 forward to provider --> client response
   |
   |  (background) POST /v1/usage { actual cost } --> z-billing
${F}

## Internals

The pre-check is intentionally coarse (at least one credit) so the hot path stays fast; exact cost is computed from the provider's reported token usage and debited after the client already has its response, so billing latency never adds to time-to-first-token.

${F}text
 time --> | pre-check | -------- provider -------- | response to client |
                                                          |
                                                          v
                                              debit(actual cost)  (off the critical path)
${F}`,
  },
  {
    title: "Cross-Service Recording",
    slug: "aura-router-recording",
    section: "aura-router",
    sortOrder: 204,
    excerpt:
      "After responding, the router records usage stats to aura-network and (when session headers are present) conversation events to aura-storage.",
    body: `# Cross-Service Recording

After responding, the router records usage to \`aura-network\` and — when session headers are present — conversation events to \`aura-storage\`, all without blocking the client.

## Overview

- \`aura-network\` \`POST /internal/usage\` with \`orgId\`, \`projectId\`, \`zeroUserId\`, and \`durationMs\`.
- \`aura-storage\` \`POST /internal/events\` when \`X-Aura-Session-Id\` / \`X-Aura-Agent-Id\` / \`X-Aura-Project-Id\` attach the request to a session.
- All recording is fire-and-forget; a recording failure never affects the proxied response.
- Internal calls authenticate with each service's internal token (\`AURA_NETWORK_TOKEN\`, \`AURA_STORAGE_TOKEN\`).

## Architecture

${F}text
 client response sent
        |
        +--> aura-network  POST /internal/usage   { orgId, projectId, zeroUserId, durationMs }
        |
        +--> aura-storage  POST /internal/events  (only if X-Aura-* session headers present)
${F}

## Internals

Recording is detached from the request future, so even if a downstream service is slow or unreachable the user already has their tokens; missing session headers simply skip the \`aura-storage\` write.

${F}text
 X-Aura-Session-Id ? --no--> skip event storage
                     --yes-> POST /internal/events { session, agent, project, messages }
${F}`,
  },
  {
    title: "Image Generation",
    slug: "aura-router-image-generation",
    section: "aura-router",
    sortOrder: 205,
    excerpt:
      "Synchronous and SSE image generation across OpenAI and Gemini, with watermarking, style-lock prompts, and S3/aura-storage storage.",
    body: `# Image Generation

Synchronous and SSE image generation across OpenAI and Gemini, with automatic watermarking, style-lock prompts, and S3 + \`aura-storage\` artifact storage.

## Overview

- \`POST /v1/generate-image\` (sync, one response) and \`POST /v1/generate-image/stream\` (SSE progress + partial previews).
- Models: \`gpt-image-2\`, \`gpt-image-1\`, \`gemini-nano-banana\`; \`promptMode\` (new / remix / edit) can override model selection.
- A style-lock prompt is appended for consistent product renders unless \`isIteration\` is true; reference images are supported.
- Returns watermarked + original S3 URLs; auto-stores the artifact in \`aura-storage\` when \`projectId\` is given.
- Flat billing per model; \`GET /v1/generate-image/config\` lists models and ETAs.

## Architecture

${F}text
 POST /v1/generate-image[/stream]
   |  resolve model (promptMode override)
   |  append style-lock prompt (unless isIteration)
   v
 provider (OpenAI gpt-image-*, Google gemini)
   |  watermark + upload to S3
   v
 { imageUrl (watermarked), originalUrl, meta }
   |  if projectId: store artifact in aura-storage
${F}

## Internals

The streaming path emits \`start\`, \`progress\`, \`partial-image\`, and \`completed\` SSE events for live UI feedback; the sync path performs the same work but returns only the final payload.

${F}text
 stream:  start -> progress(10%) -> partial-image -> progress(50%) -> completed{ imageUrl, originalUrl, meta }
 sync:    (same pipeline) -------------------------------------------> 200 { imageUrl, originalUrl, meta }
${F}`,
  },
  {
    title: "3D Generation (Tripo)",
    slug: "aura-router-3d-generation",
    section: "aura-router",
    sortOrder: 206,
    excerpt:
      "Image-to-3D via Tripo: always async (client-polled or server-driven SSE), producing a GLB stored to S3.",
    body: `# 3D Generation (Tripo)

Image-to-3D generation via Tripo. Because runs take 45-120 seconds it is always asynchronous — either client-polled or server-driven over SSE — producing a GLB model stored to S3.

## Overview

- \`POST /v1/generate-3d\` returns a \`taskId\` immediately; the client polls \`GET /v1/generate-3d/:taskId\`.
- \`POST /v1/generate-3d/stream\` drives the full submit -> poll -> store lifecycle over SSE.
- A base64 \`imageUrl\` is uploaded to S3 first (Tripo requires a public URL).
- 50 credits are charged on submission; completion returns the GLB URL and \`polyCount\`.
- Auto-stores the artifact in \`aura-storage\` when \`projectId\` is given.

## Architecture

${F}text
 POST /v1/generate-3d[/stream]
   |  base64 image ? --> upload to S3 first
   v
 submit Tripo task --> taskId
   |
   |  polling:   GET /v1/generate-3d/:taskId  (queued -> processing -> success|failed)
   |  streaming: server polls and emits SSE   (submitted -> progress -> completed)
   v
 GLB URL + polyCount  (+ aura-storage artifact if projectId)
${F}

## Internals

The non-streaming path hands polling to the client; the streaming path keeps the poll loop server-side and pushes lifecycle events, so the UI connects once and never polls.

${F}text
 sync:    submit -> { taskId } ; client GET :taskId until status=success -> glbUrl
 stream:  submit -> SSE: submitted -> progress(%) -> completed{ glbUrl, polyCount }
${F}`,
  },
  {
    title: "Infrastructure Crates",
    slug: "aura-router-crates",
    section: "aura-router",
    sortOrder: 207,
    excerpt:
      "The Rust (Axum) workspace: core types, JWT auth, the proxy/provider/billing/S3 domain logic, and the HTTP server.",
    body: `# Infrastructure Crates

A small Rust (Axum) workspace: pure types, JWT auth, the proxy / provider / billing / S3 domain logic, and the HTTP server.

## Overview

- \`core\` — shared error and type definitions.
- \`auth\` — JWT validation (Auth0 JWKS RS256 + HS256), with JWKS caching.
- \`domain/proxy\` — provider clients (Anthropic, OpenAI, Google, Tripo), the billing client, S3 upload, and streaming.
- \`server\` — Axum handlers, middleware (CORS, rate limiting, body limit), and routing.

## Architecture

${F}text
 server   — Axum handlers · middleware (CORS / rate limit / body limit) · routes
   |
 domain/proxy — provider clients · billing client · S3 upload · streaming
   |
 auth     — JWT (Auth0 JWKS + HS256) · JWKS cache
   |
 core     — shared types · errors
${F}

## Internals

The server layer is thin: it validates, rate-limits, and routes, then delegates all provider and billing work to \`domain/proxy\`, keeping outbound credentials and retry logic in one place.

${F}text
 request -> server (validate + route) -> domain/proxy (provider + billing + S3) -> upstream
${F}`,
  },
];
