# Live remote agent provisioning feedback and accurate VM reporting

- Date: `2026-06-17`
- Channel: `nightly`
- Version: `0.1.0-nightly.688.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.688.1

Today's nightly is centered on making remote agent cold starts feel transparent: the AgentEnvironment now streams real boot progress, accurately labels confidential VMs, and reports true VM sizing. A Windows desktop build warning was also silenced, and status probes were recalibrated to stop crying wolf on slow remote checks.

## 10:41 PM — Clean Windows desktop builds for the sidecar harness

Silenced spurious dead-code warnings on non-Unix targets so the desktop harness builds cleanly across platforms.

- Gated the managed sidecar port-detection helpers and ManagedSidecarKind variants behind cfg(any(unix, test)) so Windows builds of aura-os-desktop no longer surface dead-code warnings for Unix-only paths. (`0d90288`)

## 11:50 PM — Transparent cold starts for remote agents

AgentEnvironment now shows what a provisioning VM is actually doing — accurate isolation and resources, a live boot phase, and streaming logs — instead of an opaque spinner.

- Confidential SEV-SNP VMs are now labeled "Confidential VM" instead of being misreported as "Container", and the Resources line shows real vCPU/GiB plus the backing AWS instance type (e.g. m6a.xlarge) forwarded from the gateway, rather than the stripped tier spec. (`220e459`)
- The VM logs panel auto-opens while an agent is provisioning and silently re-polls the tail every 3 seconds, so boot and attestation output streams in live instead of showing "No platform logs yet" after a single fetch. (`41f9698`)
- Added an adaptive ~2.5s state poll during provisioning (relaxing to 15s once settled) and a coarse phase label under the Provisioning badge that progresses from "Scheduling machine…" to "Booting & attesting…" as the VM gets an endpoint. (`46dcfda`)

## 7:53 AM — Recalibrated remote agent status probes

Tuned the observability probes so remote-agent checks reflect realistic cold-start latencies and dropped a noisy informational probe from the rotation.

- Raised warning/outage latency thresholds for the remote-agent-create, remote-agent-state, and remote-agent-runtime probes (now in the 4–7 minute range) and bumped the default remote probe timeout to 5 minutes via a new AURA_STATUS_REMOTE_TIMEOUT_MS override, so legitimate slow boots stop firing as outages. (`70f1985`)
- Dropped the image-generation-stream probe from the observability, nightly, and stable release workflows and from features.json to stop tracking it as a status signal. (`70f1985`)

## Highlights

- Live VM logs and boot phases during remote agent provisioning
- Confidential SEV-SNP VMs now labeled correctly with real vCPU/GiB
- Status probe thresholds recalibrated for realistic remote latencies
- Clean cross-platform desktop builds on non-Unix targets

