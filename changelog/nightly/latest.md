# Pay-per-call LLM access and a new Claude Fable tier

- Date: `2026-06-09`
- Channel: `nightly`
- Version: `0.1.0-nightly.634.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.634.1

Today's nightly opens up Aura's LLM router to x402-based micropayments, tightens the billing client against unsafe service endpoints, and brings Anthropic's Claude Fable 5 into the managed model lineup.

## 9:25 PM — x402 micropayment endpoint for public LLM access

Aura's server now exposes a paid, x402-protected public chat completions API that settles against z-billing usage quotes.

- Added a new `/api/public/x402/v1/chat/completions` endpoint and matching `/v1/models` listing, implementing the x402 protocol directly in the Axum router so anonymous callers can pay per request without an account. (`c0684ba`)
- Defaults to the `upto` scheme with a $0.02 ceiling against Base Sepolia USDC, settling the real z-billing usage quote per call; operators can override price, scheme, network, asset, facilitator, and timeouts via the new `AURA_X402_*` environment variables documented in the README. (`c0684ba`)
- Introduced guardrails on the public surface including a configurable model allowlist, a default `aura-claude-haiku-4-5` model, max-token caps, message size and count limits, and a 120s completion timeout. (`c0684ba`)
- Extended the billing client with a usage-quote path (`LlmUsageQuote`) so the x402 handler can convert LLM token usage into a settled dollar amount. (`c0684ba`)

## 8:40 AM — Billing client now refuses insecure service URLs

The billing HTTP client validates its configured base URL before issuing any request, closing off accidental plaintext or private-network calls.

- Requests now go through a new `service_url` builder that parses the base URL with `url::Url`, normalizes trailing slashes, and rejects anything that isn't HTTPS to a public host — `http://`, loopback, RFC1918, link-local, and embedded `user:pass@` credentials all return the new `InsecureServiceUrl` error. (`46c9194`)
- Debug and test builds retain an explicit carve-out for `http://localhost` and `127.0.0.1` so local development against a mock billing service still works. (`46c9194`)

## 3:36 PM — Claude Fable 5 joins the managed Anthropic lineup

Anthropic's new Fable-class model is wired into Aura's interface with pricing, normalization, and model-picker metadata.

- Added `aura-claude-fable-5` as a featured Opus-tier Anthropic chat model with a 1M-token context window, 10× credit multiplier, and a Mythos-class description in the model picker. (`5352382`)
- Registered Claude Fable 5 pricing at $10 input / $50 output per million tokens (with $12.50 cache-write and $1 cache-read) in both the runtime pricing table and the benchmark pricing script. (`5352382`)
- Taught the model-id normalizer to map raw `claude-fable-5` and legacy ids onto the Aura-managed `aura-claude-fable-5`, so persisted selections and benchmark lookups resolve consistently. (`5352382`)

## Highlights

- New x402 public chat completions endpoint with usage-shaped settlement
- Billing client now rejects insecure or private service URLs
- Claude Fable 5 available as an Aura-managed Anthropic model

