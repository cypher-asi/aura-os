# LLM-powered status investigations land on the public status page

- Date: `2026-06-13`
- Channel: `nightly`
- Version: `0.1.0-nightly.662.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.662.1

Today's nightly brings a new observability layer to Aura: when status probes fail, an LLM investigator now drafts scoped, evidence-backed diagnoses that are uploaded as release artifacts and rendered directly on the marketing status page. A follow-up fix tightens the prompt against overstated impact and groups repeated troubleshooting cards so the page stays readable when many checks share one root cause.

## 8:38 PM — LLM investigation reports for failing status checks

Aura's observability pipeline gained an LLM-backed investigator that turns failing status probes into structured, evidence-scoped diagnoses, surfaced both in CI artifacts and on the public status page — with a quick follow-up to keep impact claims honest and collapse duplicate cards.

- Added an LLM-powered status investigator that produces structured reports (proof points, possible causes, reproduction steps, affected areas, next actions) for failing probes, wired into the observability workflow and both nightly and stable desktop release pipelines so investigation artifacts are uploaded alongside existing status checks. (`7226b56`)
- Surfaced investigation results in the marketing StatusView with a new API route and dedicated UI, giving visitors evidence-backed context for outages instead of a bare red indicator. (`7226b56`)
- Hardened the investigator system prompt to distinguish eval failures from real user-facing outages and to localize diagnoses to the specific failing endpoint or route when broader health checks still pass, preventing overstated incident scope. (`37e7054`)
- Grouped repeated troubleshooting cards on the status page so when multiple checks share one root cause (for example, a single quota exhaustion blocking several remote-agent probes) they collapse into one card listing the covered checks. (`37e7054`)

## Highlights

- LLM investigation reports for failing status checks
- Status page renders investigations with grouped troubleshooting cards
- Nightly and stable desktop releases now upload investigation artifacts

