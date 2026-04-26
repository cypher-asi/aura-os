//! Terminal "agent stuck" anti-waste signal classifier.

#[test]
fn agent_stuck_classifier_recognises_harness_anti_waste_signal() {
    let incident = "CRITICAL: All tool calls have returned errors for 5 \
                    consecutive iterations. The agent appears stuck. \
                    Stopping to prevent waste.";
    assert!(
        aura_os_server::phase7_test_support::is_agent_stuck_terminal_signal(incident),
        "verbatim harness anti-waste signal from the d12b2cc3 incident \
         must classify as terminal — otherwise the os-server tight-loops \
         on WS reconnects while the harness replays the same error event",
    );

    for reason in [
        "critical: all tool calls have returned errors for 5 consecutive iterations",
        "CRITICAL: Agent is stuck. Stopping.",
        "Agent appears stuck after 10 consecutive errors",
        "harness: stopping to prevent waste of API credits",
        "Stopping to conserve budget — 8 consecutive failures",
    ] {
        assert!(
            aura_os_server::phase7_test_support::is_agent_stuck_terminal_signal(reason),
            "{reason:?} should classify as agent-stuck terminal — uses the \
             harness's anti-waste vocabulary and must short-circuit the restart",
        );
    }
}

#[test]
fn agent_stuck_classifier_rejects_normal_errors() {
    for reason in [
        "LLM error: stream terminated with error: Internal server error",
        "tool_call_failed: write_file returned permission denied",
        "compile error: cannot find type `Foo` in module `bar`",
        "git push failed: remote storage exhausted",
        "task reached implementation phase but no file operations completed",
        "rate limit exceeded (429)",
        "socket hang up",
    ] {
        assert!(
            !aura_os_server::phase7_test_support::is_agent_stuck_terminal_signal(reason),
            "{reason:?} is NOT an agent-stuck signal — classifier must not \
             swallow legit transient / remediable reasons",
        );
    }
}
