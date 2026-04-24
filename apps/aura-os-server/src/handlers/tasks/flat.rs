use axum::extract::{Path, State};
use axum::Json;

use aura_os_core::{ProjectId, Task, TaskId};

use super::crud::{delete_task, transition_task, update_task, UpdateTaskBody};
use super::extraction::get_task;
use crate::dto::TransitionTaskRequest;
use crate::error::ApiResult;
use crate::state::{AppState, AuthJwt};

pub(crate) async fn get_task_flat(
    state: State<AppState>,
    jwt: AuthJwt,
    Path(task_id): Path<TaskId>,
) -> ApiResult<Json<Task>> {
    get_task(state, jwt, Path((ProjectId::nil(), task_id))).await
}

pub(crate) async fn update_task_flat(
    state: State<AppState>,
    jwt: AuthJwt,
    Path(task_id): Path<TaskId>,
    body: Json<UpdateTaskBody>,
) -> ApiResult<Json<Task>> {
    update_task(state, jwt, Path((ProjectId::nil(), task_id)), body).await
}

pub(crate) async fn delete_task_flat(
    state: State<AppState>,
    jwt: AuthJwt,
    Path(task_id): Path<TaskId>,
) -> ApiResult<axum::http::StatusCode> {
    delete_task(state, jwt, Path((ProjectId::nil(), task_id))).await
}

pub(crate) async fn transition_task_flat(
    state: State<AppState>,
    jwt: AuthJwt,
    Path(task_id): Path<TaskId>,
    body: Json<TransitionTaskRequest>,
) -> ApiResult<Json<Task>> {
    transition_task(state, jwt, Path((ProjectId::nil(), task_id)), body).await
}
