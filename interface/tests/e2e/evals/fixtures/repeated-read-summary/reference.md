# Harness Context Notes

Aura's harness needs to make repeated long-running coding sessions cheaper, more stable, and easier to reason about.

## Cache usage

Prompt caching is valuable when the system keeps a stable reusable prefix across turns. Tool definitions, system instructions, and repeated repo context are good candidates for cache reuse. Cache writes are not free, so short sessions can look more expensive before the repeated cache reads pay that cost back.

## Context pressure

Long sessions accumulate user turns, assistant output, tool output, and cached prompt segments. If the runtime only watches the billed input tokens for the latest turn, it can badly under-report the true context pressure inside the prompt window. Better systems track occupied prompt footprint and reserve output headroom before the window is exhausted.

## Reliability

Compaction, overflow recovery, and trustworthy usage telemetry are all reliability features. If the agent hits the context limit without recovery, the user sees a brittle failure. If the system can compact older context, retry with a smaller response budget, and surface accurate context utilization, it can keep working much longer.

## Practical takeaways

- Stable prefixes make caching worthwhile.
- Dynamic read-heavy tool output should usually be compacted more aggressively than the reusable prefix.
- Validation needs to look at cost, speed, reliability, and quality together.
- A trustworthy harness should expose provider, cache reads and writes, changed files, and estimated context occupancy.
