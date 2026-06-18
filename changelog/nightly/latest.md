# Live remote agent boot UX and deeper desktop release probes

- Date: `2026-06-17`
- Channel: `nightly`
- Version: `0.1.0-nightly.689.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.689.1

Today's nightly focuses on making remote agent cold starts feel alive—accurate VM labels, streaming boot logs, and a real provisioning phase indicator—alongside a substantial expansion of desktop release observability covering tool calls, agent-to-agent messaging, and subagent workflows.

## 10:41 PM — Cross-platform desktop build cleanup for sidecar port detection

Quiets Windows build warnings caused by Unix-only sidecar helpers being matched on every platform.

- Gated the managed sidecar port-detection helpers and ManagedSidecarKind variants behind cfg(any(unix, test)) so non-Unix Desktop builds no longer trip dead-code warnings while still keeping the cross-platform match intact. (`0d90288`)

## 11:50 PM — Live remote agent provisioning experience

Remote agent status now shows accurate VM details and streams real-time boot progress instead of a static spinner during cold starts.

- Confidential SEV-SNP VMs are now correctly labeled as 'Confidential VM' (previously mislabeled 'Container') and the status card reports real vCPU/GiB with the AWS instance type via a new vm_instance_type field plumbed through the swarm state proxy, instead of the stripped tier spec. (`220e459`)
- The remote logs panel now polls the tail every 3s in the background and auto-opens while the agent is provisioning, so boot and attestation output streams in live instead of stalling on 'No platform logs yet'. (`41f9698`)
- Added an adaptive 2.5s VM state poll during provisioning (15s once settled) and a coarse phase label under the Provisioning badge—'Scheduling machine…' before an endpoint appears, then 'Booting & attesting…'—so slow cold starts show forward motion. (`46dcfda`)

## 7:53 AM — Recalibrated remote agent probe latency budgets

Observability and release workflows now tolerate realistic remote agent timings and drop a noisy image-generation probe.

- Raised remote-agent probe warning/outage thresholds to multi-minute budgets (240s warning, 360–420s outage) and bumped the default remote probe timeout to 5 minutes via a new AURA_STATUS_REMOTE_TIMEOUT_MS override, reducing false-positive alerts on legitimate cold starts. (`70f1985`)
- Removed the informational image-generation-stream check from the observability and release workflows along with its features.json entry, trimming a low-signal probe from production status reporting. (`70f1985`)

## 8:31 PM — Desktop release probes for tools, A2A, subagents—and a context hydration fix

Server-side context lookups now survive subagent sessions, and desktop release runs gained deep end-to-end probes for project agent workflows.

- Fixed agent context contents and usage endpoints to consider every session across matching project_agents instead of only the newest—newer subagent bookkeeping sessions with no assistant usage no longer hide real context from the most recent active session. (`e74d791`)
- Nightly and stable desktop release workflows now run new probes for project-bound tool round-trips (write_file/read_file/run_command), agent-to-agent send_to_agent delivery and callbacks, foreground subagent task completion with context hydration, and real harness skill invocation in a chat turn. (`6c66313`)
- Documented the expanded coverage in aura-feature-health, adding 'Project Agent Workflows' and skill-invocation groups so the desktop release status page reflects the new end-to-end checks. (`6c66313`)

## Highlights

- Confidential VMs now report real resources and the correct isolation label
- Live VM logs and adaptive polling during agent provisioning
- Desktop release probes now cover tools, A2A, and subagents
- Context hydration fixed after subagent sessions

