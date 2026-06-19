//! `POST /v1/projects/:id/dev-loop` cold-start handler.
//!
//! After the Stage 2 unification this handler is a thin HTTP wrapper:
//! it resolves the bound Loop instance id, builds a [`super::super::run::RunRequest`]
//! flagged with [`super::super::run::RunMode::Automation`], and delegates
//! the bootstrap pipeline (credit preflight, context resolution,
//! `start_or_adopt`, adopt-shortcut, orphan recovery, session
//! materialisation, stream connect, forwarder spawn, registry insert,
//! `loop_started` emit) to [`super::super::run::run_automaton`].

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::ProjectId;

use crate::dto::LoopStatusResponse;
use crate::error::ApiResult;
use crate::state::{AppState, AuthJwt, AuthSession};

use super::super::loop_engineering::parse_start_loop_request;
use super::super::run::{run_automaton, RunMode, RunRequest};
use super::super::types::LoopQueryParams;
use super::common::{loop_user_id, resolve_loop_instance_id};

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
