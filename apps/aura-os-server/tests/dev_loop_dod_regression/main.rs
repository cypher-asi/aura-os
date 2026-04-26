//! Dev-loop hardening regressions.
//!
//! These tests lock in the behaviour added after the
//! `Create zero-program crate implementing GRID Program trait` task
//! failure that motivated the hardening plan:
//!
//! 1. **Empty workspace preflight** — starting a dev loop against a
//!    missing/empty/non-git directory must fail fast with a
//!    remediation hint *unless* a `git_repo_url` is configured, in
//!    which case the automaton is expected to clone into it.
//! 2. **Empty-path write tracking** — a `write_file` / `edit_file`
//!    tool call with a blank or missing `path` is classified as an
//!    empty-path write for diagnostics, without letting aura-os reject
//!    a harness terminal event.
//! 3. **Harness-owned verification** — a run that edited source but
//!    lacks local build/test/fmt/clippy counters is still accepted by
//!    aura-os; the harness owns Definition-of-Done.
//!
//! The intent is explicitly *replay*-style: we don't spin up a live
//! server, task service, or automaton. We exercise the public
//! [`aura_os_server::phase7_test_support`] entry points that wrap the
//! exact functions production start paths call.

mod completion;
mod events;
mod preflight;
mod push;
mod retry;
