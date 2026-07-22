//! `POST /v1/projects/:id/dev-loop` cold-start handler.
//!
//! After the Stage 2 unification this handler is a thin HTTP wrapper:
//! it resolves the bound Loop instance id, builds a [`super::super::run::RunRequest`]
//! flagged with [`super::super::run::RunMode::Automation`], and delegates
//! the bootstrap pipeline (credit preflight, context resolution,
//! `start_or_adopt`, adopt-shortcut, orphan recovery, session
//! materialisation, stream connect, forwarder spawn, registry insert,
//! `loop_started` emit) to [`super::super::run::run_automaton`].

use std::fmt::Write as _;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::{AgentInstanceId, ProjectId};
use aura_os_storage::{CreateSpecRequest, CreateTaskRequest, StorageClient, StorageTask};

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::handlers::tasks::{broadcast_task_saved, storage_task_to_task};
use crate::state::{AppState, AuthJwt, AuthSession};

use super::super::loop_engineering::{
    parse_start_loop_request, ApprovalPolicy, LearningPolicy, LoopEngineeringContract,
    VerifierCommand,
};
use super::super::run::{run_automaton, RunMode, RunRequest};
use super::super::types::LoopQueryParams;
use super::common::{loop_user_id, resolve_loop_instance_id};

const LOOP_ENGINEERING_SPEC_TITLE: &str = "Loop Engineering";
const LOOP_ENGINEERING_SPEC_MARKDOWN: &str =
    "# Loop Engineering\n\nTasks generated from Loop Engineering runs.\n";

#[derive(Debug)]
struct SeededLoopEngineeringTask {
    task: StorageTask,
    created: bool,
}

pub(crate) async fn start_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    session: AuthSession,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<LoopStatusResponse>)> {
    let agent_instance_id = resolve_loop_instance_id(&state, project_id, &params).await?;
    let loop_engineering = parse_start_loop_request(&body)?;
    if let Some(contract) = loop_engineering.as_ref() {
        let storage = state.require_storage_client()?;
        let seeded =
            ensure_loop_engineering_task(storage, &jwt, project_id, agent_instance_id, contract)
                .await?;
        if seeded.created {
            match storage_task_to_task(seeded.task) {
                Ok(task) => broadcast_task_saved(&state, &project_id, &task),
                Err(error) => tracing::warn!(
                    %project_id,
                    %error,
                    "loop engineering task was created but could not be broadcast"
                ),
            }
        }
    } else {
        crate::handlers::tasks::prepare_task_graph_for_run(&state, &jwt, project_id).await?;
    }
    let req = RunRequest {
        loop_user_id: loop_user_id(&session),
        user_id: session.0.user_id.clone(),
        state,
        project_id,
        agent_instance_id,
        template_agent_instance_id: agent_instance_id,
        jwt,
        model: params.model,
        mode: RunMode::Automation,
        loop_engineering,
    };
    let outcome = run_automaton(req).await?;
    let (status, body) = outcome.into_loop_response();
    Ok((status, Json(body)))
}

async fn ensure_loop_engineering_task(
    storage: &StorageClient,
    jwt: &str,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    contract: &LoopEngineeringContract,
) -> ApiResult<SeededLoopEngineeringTask> {
    let goal = normalized_goal(&contract.goal)?;
    let title = loop_engineering_title(&goal);
    let description = loop_engineering_description(&goal, contract);
    let project_id_string = project_id.to_string();
    let agent_instance_id_string = agent_instance_id.to_string();

    let existing_tasks = storage
        .list_tasks(&project_id_string, jwt)
        .await
        .map_err(|error| {
            ApiError::internal(format!("listing tasks for loop engineering: {error}"))
        })?;
    if let Some(task) = find_existing_loop_engineering_task(
        &existing_tasks,
        &title,
        &description,
        &agent_instance_id_string,
    ) {
        let task = ensure_pending_task_ready(storage, jwt, task.clone()).await?;
        return Ok(SeededLoopEngineeringTask {
            task,
            created: false,
        });
    }

    let spec_id = ensure_loop_engineering_spec(storage, jwt, &project_id_string).await?;
    let created = storage
        .create_task(
            &project_id_string,
            jwt,
            &CreateTaskRequest {
                spec_id,
                title,
                org_id: None,
                description: Some(description),
                status: Some("ready".to_string()),
                order_index: Some((existing_tasks.len() + 1) as i32),
                dependency_ids: None,
                assigned_project_agent_id: Some(agent_instance_id_string),
            },
        )
        .await
        .map_err(|error| ApiError::internal(format!("creating loop engineering task: {error}")))?;

    let task = ensure_pending_task_ready(storage, jwt, created).await?;
    Ok(SeededLoopEngineeringTask {
        task,
        created: true,
    })
}

async fn ensure_pending_task_ready(
    storage: &StorageClient,
    jwt: &str,
    task: StorageTask,
) -> ApiResult<StorageTask> {
    if task.status.as_deref() != Some("pending") {
        return Ok(task);
    }
    aura_os_tasks::safe_transition(storage, jwt, &task.id, aura_os_core::TaskStatus::Ready)
        .await
        .map_err(|error| {
            ApiError::internal(format!("promoting loop engineering task to Ready: {error}"))
        })?;
    storage.get_task(&task.id, jwt).await.map_err(|error| {
        ApiError::internal(format!(
            "reloading loop engineering task after promotion: {error}"
        ))
    })
}

async fn ensure_loop_engineering_spec(
    storage: &StorageClient,
    jwt: &str,
    project_id: &str,
) -> ApiResult<String> {
    let mut specs = storage.list_specs(project_id, jwt).await.map_err(|error| {
        ApiError::internal(format!("listing specs for loop engineering: {error}"))
    })?;
    specs.sort_by_key(|spec| spec.order_index.unwrap_or(i32::MAX));
    if let Some(spec) = specs.into_iter().find(|spec| !spec.id.trim().is_empty()) {
        return Ok(spec.id);
    }

    let spec = storage
        .create_spec(
            project_id,
            jwt,
            &CreateSpecRequest {
                title: LOOP_ENGINEERING_SPEC_TITLE.to_string(),
                org_id: None,
                order_index: Some(0),
                markdown_contents: Some(LOOP_ENGINEERING_SPEC_MARKDOWN.to_string()),
            },
        )
        .await
        .map_err(|error| ApiError::internal(format!("creating loop engineering spec: {error}")))?;
    Ok(spec.id)
}

fn find_existing_loop_engineering_task<'a>(
    tasks: &'a [StorageTask],
    title: &str,
    description: &str,
    agent_instance_id: &str,
) -> Option<&'a StorageTask> {
    tasks.iter().find(|task| {
        let assigned = task.assigned_project_agent_id.as_deref();
        task.title.as_deref() == Some(title)
            && task.description.as_deref() == Some(description)
            && active_task_status(task.status.as_deref())
            && (assigned.is_none() || assigned == Some(agent_instance_id))
    })
}

fn active_task_status(status: Option<&str>) -> bool {
    !matches!(
        status.unwrap_or_default().to_ascii_lowercase().as_str(),
        "done" | "failed"
    )
}

fn normalized_goal(goal: &str) -> ApiResult<String> {
    let normalized = goal.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err(ApiError::bad_request(
            "loopEngineering.goal must not be empty",
        ));
    }
    Ok(normalized)
}

fn loop_engineering_title(goal: &str) -> String {
    format!("Loop Engineering: {}", truncate_chars(goal, 72))
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = value
        .chars()
        .take(max_chars.saturating_sub(3))
        .collect::<String>();
    truncated.push_str("...");
    truncated
}

fn loop_engineering_description(goal: &str, contract: &LoopEngineeringContract) -> String {
    let mut description = String::new();
    let _ = writeln!(description, "# Loop Engineering Task\n");
    let _ = writeln!(description, "## Goal\n{goal}\n");

    let criteria = normalized_lines(&contract.success_criteria);
    let _ = writeln!(description, "## Success Criteria");
    if criteria.is_empty() {
        let _ = writeln!(description, "- Requested behavior works end to end");
        let _ = writeln!(
            description,
            "- Existing tests, build, or project-native smoke checks pass"
        );
        let _ = writeln!(
            description,
            "- Final report includes evidence, changes, risks, and learnings\n"
        );
    } else {
        for criterion in criteria {
            let _ = writeln!(description, "- {criterion}");
        }
        description.push('\n');
    }

    let verifier_commands = normalized_verifier_commands(&contract.verifier_commands);
    let _ = writeln!(description, "## Verification");
    if verifier_commands.is_empty() {
        let _ = writeln!(
            description,
            "- Discover and run the project-native checks that validate the change."
        );
    } else {
        for command in verifier_commands {
            let _ = writeln!(description, "- {command}");
        }
    }
    description.push('\n');

    let _ = writeln!(description, "## Loop Settings");
    let _ = writeln!(
        description,
        "- Requested iteration budget: {}",
        contract.max_iterations
    );
    let _ = writeln!(
        description,
        "- Approval policy: {}",
        approval_policy_label(contract.approval_policy)
    );
    for line in learning_policy_lines(contract.learning) {
        let _ = writeln!(description, "- {line}");
    }
    description.push('\n');

    let _ = writeln!(description, "## Completion Report");
    let _ = writeln!(
        description,
        "Include the changes made, verification evidence, remaining risks, and learnings."
    );
    description
}

fn normalized_lines(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn normalized_verifier_commands(commands: &[VerifierCommand]) -> Vec<String> {
    commands
        .iter()
        .filter_map(|command| {
            let command_text = command.command.trim();
            if command_text.is_empty() {
                return None;
            }
            let label = command.label.trim();
            let prefix = if label.is_empty() {
                format!("`{command_text}`")
            } else {
                format!("{label}: `{command_text}`")
            };
            Some(match command.expected_outcome.as_deref() {
                Some(expected) if !expected.trim().is_empty() => {
                    format!("{prefix} (expected: {})", expected.trim())
                }
                _ => prefix,
            })
        })
        .collect()
}

fn approval_policy_label(policy: ApprovalPolicy) -> &'static str {
    match policy {
        ApprovalPolicy::ProposeOnly => "propose_only",
        ApprovalPolicy::ApplyWithinWorkspace => "apply_within_workspace",
    }
}

fn learning_policy_lines(policy: LearningPolicy) -> Vec<&'static str> {
    vec![
        if policy.capture_trace {
            "Capture trace: enabled"
        } else {
            "Capture trace: disabled"
        },
        if policy.propose_evals {
            "Eval proposals: enabled"
        } else {
            "Eval proposals: disabled"
        },
        if policy.propose_skills {
            "Skill proposals: enabled"
        } else {
            "Skill proposals: disabled"
        },
        if policy.summarize_regressions {
            "Regression summary: enabled"
        } else {
            "Regression summary: disabled"
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contract() -> LoopEngineeringContract {
        LoopEngineeringContract {
            goal: "Add a dark mode toggle button to the to-do app".to_string(),
            success_criteria: vec![
                "Toggle switches background between white and black".to_string(),
                "Project-native checks pass".to_string(),
            ],
            verifier_commands: vec![VerifierCommand {
                label: "Tests".to_string(),
                command: "npm test".to_string(),
                expected_outcome: Some("all tests pass".to_string()),
            }],
            max_iterations: 2,
            approval_policy: ApprovalPolicy::ApplyWithinWorkspace,
            learning: LearningPolicy {
                capture_trace: true,
                propose_evals: true,
                propose_skills: false,
                summarize_regressions: true,
            },
        }
    }

    #[test]
    fn description_includes_contract_fields() {
        let contract = contract();
        let description = loop_engineering_description(
            "Add a dark mode toggle button to the to-do app",
            &contract,
        );

        assert!(description.contains("## Goal"));
        assert!(description.contains("Toggle switches background between white and black"));
        assert!(description.contains("Tests: `npm test` (expected: all tests pass)"));
        assert!(description.contains("Requested iteration budget: 2"));
        assert!(description.contains("Approval policy: apply_within_workspace"));
        assert!(description.contains("Skill proposals: disabled"));
    }

    #[tokio::test]
    async fn ensure_loop_engineering_task_creates_ready_task_and_reuses_duplicate() {
        let (base_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
        let storage = StorageClient::with_base_url(&base_url);
        let project_id = ProjectId::new();
        let agent_instance_id = AgentInstanceId::new();
        let jwt = "test-jwt";
        let contract = contract();

        let first =
            ensure_loop_engineering_task(&storage, jwt, project_id, agent_instance_id, &contract)
                .await
                .expect("task should be seeded");
        assert!(first.created);

        let specs = storage
            .list_specs(&project_id.to_string(), jwt)
            .await
            .expect("specs should list");
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].title.as_deref(), Some(LOOP_ENGINEERING_SPEC_TITLE));

        let tasks = storage
            .list_tasks(&project_id.to_string(), jwt)
            .await
            .expect("tasks should list");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].status.as_deref(), Some("ready"));
        let expected_agent_instance_id = agent_instance_id.to_string();
        assert_eq!(
            tasks[0].assigned_project_agent_id.as_deref(),
            Some(expected_agent_instance_id.as_str())
        );
        assert!(tasks[0]
            .description
            .as_deref()
            .unwrap_or_default()
            .contains("Add a dark mode toggle button"));

        let second =
            ensure_loop_engineering_task(&storage, jwt, project_id, agent_instance_id, &contract)
                .await
                .expect("duplicate should be reused");
        assert!(!second.created);
        assert_eq!(second.task.id, first.task.id);

        let tasks_after_second_start = storage
            .list_tasks(&project_id.to_string(), jwt)
            .await
            .expect("tasks should list");
        assert_eq!(tasks_after_second_start.len(), 1);
    }
}
