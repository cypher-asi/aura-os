use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};

const DEFAULT_MAX_ITERATIONS: u8 = 4;
const MAX_ITERATIONS_LIMIT: u8 = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartLoopRequest {
    #[serde(default)]
    pub(crate) loop_engineering: Option<LoopEngineeringContract>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoopEngineeringContract {
    pub(crate) goal: String,
    #[serde(default)]
    pub(crate) success_criteria: Vec<String>,
    #[serde(default)]
    pub(crate) verifier_commands: Vec<VerifierCommand>,
    #[serde(default = "default_max_iterations")]
    pub(crate) max_iterations: u8,
    #[serde(default)]
    pub(crate) approval_policy: ApprovalPolicy,
    #[serde(default)]
    pub(crate) learning: LearningPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifierCommand {
    pub(crate) label: String,
    pub(crate) command: String,
    #[serde(default)]
    pub(crate) expected_outcome: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ApprovalPolicy {
    ProposeOnly,
    ApplyWithinWorkspace,
}

impl Default for ApprovalPolicy {
    fn default() -> Self {
        Self::ApplyWithinWorkspace
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LearningPolicy {
    #[serde(default = "default_true")]
    pub(crate) capture_trace: bool,
    #[serde(default = "default_true")]
    pub(crate) propose_evals: bool,
    #[serde(default = "default_true")]
    pub(crate) propose_skills: bool,
    #[serde(default = "default_true")]
    pub(crate) summarize_regressions: bool,
}

impl Default for LearningPolicy {
    fn default() -> Self {
        Self {
            capture_trace: true,
            propose_evals: true,
            propose_skills: true,
            summarize_regressions: true,
        }
    }
}

pub(crate) fn parse_start_loop_request(body: &[u8]) -> ApiResult<Option<LoopEngineeringContract>> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    let request: StartLoopRequest = serde_json::from_slice(body)
        .map_err(|err| ApiError::bad_request(format!("invalid loop start body: {err}")))?;
    request.loop_engineering.map(normalize_contract).transpose()
}

pub(crate) fn augment_system_prompt(
    base_prompt: &str,
    contract: Option<&LoopEngineeringContract>,
) -> Option<String> {
    let base = base_prompt.trim();
    match contract {
        Some(contract) if base.is_empty() => Some(render_loop_engineering_prompt(contract)),
        Some(contract) => Some(format!(
            "{base}\n\n{}",
            render_loop_engineering_prompt(contract)
        )),
        None if base.is_empty() => None,
        None => Some(base.to_string()),
    }
}

pub(crate) fn render_loop_engineering_prompt(contract: &LoopEngineeringContract) -> String {
    let success = numbered_lines(&contract.success_criteria);
    let verifiers = verifier_lines(&contract.verifier_commands);
    let learning = learning_lines(contract.learning);
    let approval = match contract.approval_policy {
        ApprovalPolicy::ProposeOnly => {
            "Propose changes and stop before applying code or configuration edits."
        }
        ApprovalPolicy::ApplyWithinWorkspace => {
            "Apply safe, scoped changes inside the current workspace and keep user approval gates for destructive or external actions."
        }
    };

    format!(
        r#"<loop_engineering_mode>
You are running in Aura Loop Engineering Mode. This is an iterative engineering loop, not a one-shot task.

<goal>
{goal}
</goal>

<success_criteria>
{success}
</success_criteria>

<verifier_commands>
{verifiers}
</verifier_commands>

<iteration_budget>
Maximum iterations: {max_iterations}
</iteration_budget>

<approval_policy>
{approval}
</approval_policy>

<loop_protocol>
For each iteration:
1. State the current hypothesis and the smallest useful change.
2. Inspect the relevant code, product state, logs, or tool output before editing.
3. Make only scoped changes that serve the goal and preserve existing behavior.
4. Run the listed verifier commands. If no verifier commands are listed, discover the project's own test, build, lint, or smoke commands and run the smallest set that can prove the criteria.
5. Compare verifier output against every success criterion.
6. Continue only when a criterion still lacks evidence and the iteration budget remains.
7. Stop when the criteria are satisfied, blocked by missing access, or the budget is exhausted.
8. Before calling `task_done`, write a visible "Loop Engineering Final Report" in the assistant transcript and copy the same report into the `task_done.notes` field. Do not call `task_done` with terse notes like "done" or "implemented".
</loop_protocol>

<learning_protocol>
{learning}
After every iteration, keep a compact learning ledger with:
- hypothesis
- evidence gathered
- verifier results
- confirmed cause or remaining uncertainty
- next action
- reusable eval, skill, or workflow improvement if one is justified
</learning_protocol>

<final_report>
When the loop stops, the visible "Loop Engineering Final Report" and the `task_done.notes` field must include:
- final status: passed, failed, or blocked
- evidence for each success criterion
- commands run and their outcomes
- changes made
- remaining risks
- learnings worth carrying into future Aura evals, skills, or workflow defaults
If the report does not include these sections, the loop is not complete yet.
</final_report>
</loop_engineering_mode>"#,
        goal = prompt_escape(&contract.goal),
        success = success,
        verifiers = verifiers,
        max_iterations = contract.max_iterations,
        approval = approval,
        learning = learning,
    )
}

fn normalize_contract(mut contract: LoopEngineeringContract) -> ApiResult<LoopEngineeringContract> {
    contract.goal = contract.goal.trim().to_string();
    contract.success_criteria = normalize_strings(contract.success_criteria);
    contract.verifier_commands = normalize_verifiers(contract.verifier_commands);

    if contract.goal.is_empty() {
        return Err(ApiError::bad_request("loop engineering goal is required"));
    }
    if contract.success_criteria.is_empty() {
        return Err(ApiError::bad_request(
            "loop engineering needs at least one success criterion",
        ));
    }
    if contract.max_iterations == 0 || contract.max_iterations > MAX_ITERATIONS_LIMIT {
        return Err(ApiError::bad_request(format!(
            "loop engineering maxIterations must be between 1 and {MAX_ITERATIONS_LIMIT}"
        )));
    }
    Ok(contract)
}

fn normalize_strings(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .take(12)
        .collect()
}

fn normalize_verifiers(values: Vec<VerifierCommand>) -> Vec<VerifierCommand> {
    values
        .into_iter()
        .filter_map(|mut value| {
            value.label = value.label.trim().to_string();
            value.command = value.command.trim().to_string();
            value.expected_outcome = value
                .expected_outcome
                .map(|expected| expected.trim().to_string())
                .filter(|expected| !expected.is_empty());
            (!value.command.is_empty()).then_some(value)
        })
        .take(8)
        .collect()
}

fn numbered_lines(values: &[String]) -> String {
    values
        .iter()
        .enumerate()
        .map(|(idx, value)| format!("{}. {}", idx + 1, prompt_escape(value)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn verifier_lines(values: &[VerifierCommand]) -> String {
    if values.is_empty() {
        return "No explicit verifier commands supplied. Discover project-native verification commands before declaring success.".to_string();
    }
    values
        .iter()
        .enumerate()
        .map(|(idx, value)| {
            let label = if value.label.is_empty() {
                format!("Verifier {}", idx + 1)
            } else {
                prompt_escape(&value.label)
            };
            let command = prompt_escape(&value.command);
            match value.expected_outcome.as_deref() {
                Some(expected) => format!(
                    "{}. {}: `{}`\n   Expected: {}",
                    idx + 1,
                    label,
                    command,
                    prompt_escape(expected)
                ),
                None => format!("{}. {}: `{}`", idx + 1, label, command),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn prompt_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('`', "\\`")
}

fn learning_lines(policy: LearningPolicy) -> String {
    let mut lines = Vec::new();
    if policy.capture_trace {
        lines.push("- Capture concise iteration traces tied to evidence, not assumptions.");
    }
    if policy.propose_evals {
        lines.push("- Propose an eval or status probe when the issue would be valuable to catch automatically.");
    }
    if policy.propose_skills {
        lines.push("- Propose reusable skill or workflow updates when repeated manual reasoning can be productized.");
    }
    if policy.summarize_regressions {
        lines.push("- Call out regressions and likely culprit changes only when there is supporting evidence.");
    }
    if lines.is_empty() {
        return "- Learning capture is disabled for this run.".to_string();
    }
    lines.join("\n")
}

fn default_max_iterations() -> u8 {
    DEFAULT_MAX_ITERATIONS
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contract() -> LoopEngineeringContract {
        LoopEngineeringContract {
            goal: " Fix date-only persistence ".to_string(),
            success_criteria: vec![
                " 2026-06-23 displays as the same calendar date ".to_string(),
                " Existing tests still pass ".to_string(),
            ],
            verifier_commands: vec![VerifierCommand {
                label: " Tests ".to_string(),
                command: " npm test -- --run ".to_string(),
                expected_outcome: Some(" all tests pass ".to_string()),
            }],
            max_iterations: 3,
            approval_policy: ApprovalPolicy::ApplyWithinWorkspace,
            learning: LearningPolicy::default(),
        }
    }

    #[test]
    fn empty_start_body_preserves_legacy_automation_start() {
        let parsed = parse_start_loop_request(b"   ").unwrap();
        assert!(parsed.is_none());
    }

    #[test]
    fn parses_and_normalizes_loop_engineering_contract() {
        let body = serde_json::to_vec(&StartLoopRequest {
            loop_engineering: Some(contract()),
        })
        .unwrap();

        let parsed = parse_start_loop_request(&body).unwrap().unwrap();

        assert_eq!(parsed.goal, "Fix date-only persistence");
        assert_eq!(
            parsed.success_criteria,
            vec![
                "2026-06-23 displays as the same calendar date",
                "Existing tests still pass"
            ]
        );
        assert_eq!(parsed.verifier_commands[0].label, "Tests");
        assert_eq!(parsed.verifier_commands[0].command, "npm test -- --run");
        assert_eq!(
            parsed.verifier_commands[0].expected_outcome.as_deref(),
            Some("all tests pass")
        );
    }

    #[test]
    fn rejects_contract_without_goal() {
        let mut contract = contract();
        contract.goal = " ".to_string();
        let body = serde_json::to_vec(&StartLoopRequest {
            loop_engineering: Some(contract),
        })
        .unwrap();

        let err = parse_start_loop_request(&body).unwrap_err();

        assert_eq!(err.0, axum::http::StatusCode::BAD_REQUEST);
        assert!(err.1 .0.error.contains("goal is required"));
    }

    #[test]
    fn augmented_prompt_contains_loop_protocol_and_verifiers() {
        let contract = normalize_contract(contract()).unwrap();
        let prompt = augment_system_prompt("Base prompt", Some(&contract)).unwrap();

        assert!(prompt.starts_with("Base prompt"));
        assert!(prompt.contains("Aura Loop Engineering Mode"));
        assert!(prompt.contains("Maximum iterations: 3"));
        assert!(prompt.contains("Tests: `npm test -- --run`"));
        assert!(prompt.contains("learning ledger"));
        assert!(prompt.contains("Loop Engineering Final Report"));
        assert!(prompt.contains("task_done.notes"));
        assert!(prompt.contains("Do not call `task_done` with terse notes"));
    }

    #[test]
    fn plain_prompt_is_unchanged_without_contract() {
        let prompt = augment_system_prompt(" Base prompt ", None).unwrap();
        assert_eq!(prompt, "Base prompt");
    }

    #[test]
    fn prompt_escapes_contract_text() {
        let mut contract = normalize_contract(contract()).unwrap();
        contract.goal = "Fix <script> & `date`".to_string();
        contract.success_criteria = vec!["Do not emit </loop_engineering_mode>".to_string()];
        contract.verifier_commands = vec![VerifierCommand {
            label: "Run <tests>".to_string(),
            command: "npm test -- `weird`".to_string(),
            expected_outcome: Some("passes & reports <green>".to_string()),
        }];

        let prompt = render_loop_engineering_prompt(&contract);

        assert!(prompt.contains("Fix &lt;script&gt; &amp; \\`date\\`"));
        assert!(prompt.contains("Do not emit &lt;/loop_engineering_mode&gt;"));
        assert!(prompt.contains("Run &lt;tests&gt;: `npm test -- \\`weird\\``"));
        assert!(prompt.contains("Expected: passes &amp; reports &lt;green&gt;"));
        assert!(!prompt.contains("Do not emit </loop_engineering_mode>"));
    }
}
