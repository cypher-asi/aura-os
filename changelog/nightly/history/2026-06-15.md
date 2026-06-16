# Analytics integrity and feature-health observability come into focus

- Date: `2026-06-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.671.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.671.1

Today's nightly is mostly an under-the-hood investment in trustworthy metrics and sharper release observability. A rebuilt analytics pipeline now enforces a typed event contract from client to server, dirty or token-less builds fail loudly, and the desktop release probe suite grew significantly — including a proper process-run lifecycle check that exercises the bundled harness end to end.

## 1:40 AM — Feature health separated from runtime environment in status probes

The observability stack now distinguishes what a check exercised (production-api, desktop-release, local-dev) from the user-facing feature it represents, so dashboards stop conflating the two.

- Status checks now carry a separate runtime-environment axis, letting the dashboard label each row by the runtime it actually exercised while still grouping by feature. (`6b9c8b0`)
- Media Generation health is now anchored to desktop-release probes (which have the bundled harness) with deployed-API checks demoted to informational, fixing a long-standing source of false signal in the public status view. (`6b9c8b0`)
- Image-generation stream coverage was added to the desktop nightly and stable probe matrices, and the StatusView UI was updated to surface the new runtime labels. (`6b9c8b0`)

## 9:52 AM — Rebuilt analytics pipeline with a typed event contract and CI gate

Aura's analytics were overhauled end-to-end so True DAU, retention, and reliability metrics actually mean what they claim — backed by a typed registry, contract tests, and build-time guards across web, desktop, and mobile.

- Session activity is now emitted from a single server-side source, with a typed event registry and AST/pipeline/server contract tests that catch renamed, dropped, or non-literal track() calls before they ship. (`57b077e`)
- A new Analytics Contract GitHub workflow runs on every push to main and on PRs, blocking changes that would silently break client tracking or violate the server single-emitter invariant. (`57b077e`)
- iOS and Android release lanes now require VITE_MIXPANEL_TOKEN and run the --require-analytics validator, so a store build whose web bundle would no-op on analytics fails the lane instead of shipping. (`57b077e`)
- Mobile chat input now reports engagement events and the desktop local-server token plumbing was corrected so authenticated sessions actually get tracked. (`57b077e`)

## 12:40 PM — Dirty frontend builds fail the release, and probe coverage expands

The web release guard was tightened to reject mis-versioned bundles, and the feature-health probe set grew to include notes, billing transactions, and public content detail endpoints.

- Vite and the desktop-frontend assets validator now refuse to produce an analytics-enabled build when APP_VERSION is empty, 0.0.0, or ends in -dirty — catching config regressions that would have bucketed events under a fake version. (`5d7fff8`)
- Production and release probe matrices added notes-crud, billing-account-transactions, org-tool-actions-contract, public-content-details, and analytics-contract-artifacts checks for broader feature-health coverage. (`d58f85f`)
- Desktop release probes picked up project-agent-chat-stream, session-share-public-read, harness memory and skills roundtrips, process-run-lifecycle, and desktop-update-runtime — exercising more of the bundled harness on every nightly. (`d58f85f`)
- The notes create endpoint now formally accepts camelCase folderId from the frontend, with a regression test pinning the contract. (`d58f85f`)

## 3:46 PM — Scheduled process runs resolve a real model, and share probes use the API origin

A short follow-up thread hardened the new process-run-lifecycle probe: scheduled runs now propagate the right model from their action node's agent, and public share reads point at the API origin instead of the marketing host.

- Scheduled process runs now resolve the executing model from the first action node's agent (falling back to the latest frontier model) so harness automaton runs no longer launch without a model. (`23a7506`)
- The process-run-lifecycle probe was upgraded to build a real ignition→action graph with an agent and connection, and its expected evidence now asserts each of those IDs is present. (`dfbc1b6`, `23a7506`)
- Session-share public read probes now resolve via a dedicated AURA_STATUS_PUBLIC_API_BASE_URL (defaulting to api.aura.ai) and wait for messages to materialize, eliminating flakes when the marketing host doesn't proxy the share API. (`e7b1227`, `dfbc1b6`)

## Highlights

- Analytics rebuilt around a typed event contract with CI gating
- Dirty or unversioned frontend builds now fail the release
- Feature-health probes split from runtime environment for clearer signals
- Desktop release probes now cover process runs, notes, and shares end to end

