//! HTTP surface over the on-disk dev-loop run bundles written by
//! [`crate::loop_log::LoopLogWriter`]. Powers the Debug UI app and
//! the `aura-run-analyze` CLI.
//!
//! Endpoints live under `/api/debug/*`. All responses are scoped to
//! the authenticated user's validated session; the bundles
//! themselves live alongside the server's data directory.

use std::io::Cursor;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_os_core::{ProjectId, SpecId};

use crate::error::{ApiError, ApiResult};
use crate::loop_log::RunMetadata;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// GET /api/debug/projects
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub(crate) struct DebugProjectsResponse {
    pub projects: Vec<DebugProjectSummary>,
}

#[derive(Debug, Serialize)]
pub(crate) struct DebugProjectSummary {
    pub project_id: ProjectId,
    pub run_count: usize,
    pub latest_run: Option<RunMetadata>,
}

pub(crate) async fn list_projects(
    State(state): State<AppState>,
) -> ApiResult<Json<DebugProjectsResponse>> {
    let ids = state.loop_log.list_projects().await;
    let mut projects = Vec::with_capacity(ids.len());
    for id in ids {
        let runs = state.loop_log.list_runs(id).await;
        projects.push(DebugProjectSummary {
            project_id: id,
            run_count: runs.len(),
            latest_run: runs.into_iter().next(),
        });
    }
    projects.sort_by(|a, b| {
        b.latest_run
            .as_ref()
            .map(|r| r.started_at)
            .cmp(&a.latest_run.as_ref().map(|r| r.started_at))
    });
    Ok(Json(DebugProjectsResponse { projects }))
}

// ---------------------------------------------------------------------------
// GET /api/debug/projects/:project_id/runs
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub(crate) struct DebugRunsResponse {
    pub runs: Vec<RunMetadata>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ListRunsQuery {
    /// When present, only runs whose `metadata.spec_ids` contains this
    /// id are returned. Lets the Debug UI pre-filter by spec without
    /// grouping in the browser.
    pub spec_id: Option<SpecId>,
}

pub(crate) async fn list_runs(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(query): Query<ListRunsQuery>,
) -> ApiResult<Json<DebugRunsResponse>> {
    let mut runs = state.loop_log.list_runs(project_id).await;
    if let Some(spec_id) = query.spec_id {
        runs.retain(|run| run.spec_ids.iter().any(|id| *id == spec_id));
    }
    Ok(Json(DebugRunsResponse { runs }))
}

// ---------------------------------------------------------------------------
// GET /api/debug/projects/:project_id/runs/:run_id
// ---------------------------------------------------------------------------

pub(crate) async fn get_run_metadata(
    State(state): State<AppState>,
    Path((project_id, run_id)): Path<(ProjectId, String)>,
) -> ApiResult<Json<RunMetadata>> {
    match state.loop_log.read_metadata(project_id, &run_id).await {
        Some(meta) => Ok(Json(meta)),
        None => Err(ApiError::not_found(format!(
            "debug run {run_id} not found for project {project_id}"
        ))),
    }
}

// ---------------------------------------------------------------------------
// GET /api/debug/projects/:project_id/runs/:run_id/summary
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub(crate) struct DebugRunSummaryResponse {
    pub run_id: String,
    pub markdown: String,
}

pub(crate) async fn get_run_summary(
    State(state): State<AppState>,
    Path((project_id, run_id)): Path<(ProjectId, String)>,
) -> ApiResult<Json<DebugRunSummaryResponse>> {
    match state.loop_log.read_summary(project_id, &run_id).await {
        Some(markdown) => Ok(Json(DebugRunSummaryResponse { run_id, markdown })),
        None => Err(ApiError::not_found(format!(
            "debug run {run_id} summary unavailable"
        ))),
    }
}

// ---------------------------------------------------------------------------
// GET /api/debug/projects/:project_id/runs/:run_id/logs
// ---------------------------------------------------------------------------

/// Which JSONL channel inside the run bundle to read. Kept as a small
/// enum so the UI can't request arbitrary file names from disk.
#[derive(Debug, Copy, Clone, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DebugChannel {
    #[default]
    Events,
    LlmCalls,
    Iterations,
    Blockers,
    Retries,
}

impl DebugChannel {
    fn file_name(self) -> &'static str {
        match self {
            DebugChannel::Events => "events.jsonl",
            DebugChannel::LlmCalls => "llm_calls.jsonl",
            DebugChannel::Iterations => "iterations.jsonl",
            DebugChannel::Blockers => "blockers.jsonl",
            DebugChannel::Retries => "retries.jsonl",
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct LogsQuery {
    #[serde(default)]
    pub channel: DebugChannel,
    /// Cap the returned line count. Defaults to "no cap" so the full
    /// run is downloadable in one go, matching the `curl`-friendly
    /// workflows the CLI uses.
    pub limit: Option<usize>,
}

pub(crate) async fn get_run_logs(
    State(state): State<AppState>,
    Path((project_id, run_id)): Path<(ProjectId, String)>,
    Query(query): Query<LogsQuery>,
) -> ApiResult<Response> {
    let contents = state
        .loop_log
        .read_jsonl(project_id, &run_id, query.channel.file_name())
        .await
        .ok_or_else(|| {
            ApiError::not_found(format!(
                "debug run {run_id} has no {} channel",
                query.channel.file_name(),
            ))
        })?;

    let body = match query.limit {
        Some(limit) => contents
            .lines()
            .take(limit)
            .collect::<Vec<_>>()
            .join("\n"),
        None => contents,
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-ndjson; charset=utf-8")
        .body(Body::from(body))
        .map_err(|error| ApiError::internal(format!("build logs response: {error}")))
}

// ---------------------------------------------------------------------------
// GET /api/debug/projects/:project_id/runs/:run_id/export
// ---------------------------------------------------------------------------

/// Returns a zip of every file inside the run bundle. Useful for
/// sharing a run with another engineer or archiving offline.
pub(crate) async fn export_run(
    State(state): State<AppState>,
    Path((project_id, run_id)): Path<(ProjectId, String)>,
) -> ApiResult<Response> {
    let dir = state.loop_log.bundle_dir(project_id, &run_id);
    if !dir.is_dir() {
        return Err(ApiError::not_found(format!(
            "debug run {run_id} not found for project {project_id}"
        )));
    }

    let bytes = tokio::task::spawn_blocking(move || zip_bundle_dir(&dir))
        .await
        .map_err(|error| ApiError::internal(format!("zip task join error: {error}")))?
        .map_err(|error| ApiError::internal(format!("zip run bundle: {error}")))?;

    let filename = format!("debug-run-{run_id}.zip");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(Body::from(bytes))
        .map_err(|error| ApiError::internal(format!("build export response: {error}")))
}

fn zip_bundle_dir(dir: &std::path::Path) -> std::io::Result<Vec<u8>> {
    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = MiniZipWriter::new(&mut buffer);
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let bytes = std::fs::read(&path)?;
            writer.add_stored(&name, &bytes)?;
        }
        writer.finish()?;
    }
    Ok(buffer.into_inner())
}

// ---------------------------------------------------------------------------
// Minimal zip writer (STORE method, no compression) — avoids pulling
// in a new crate for what amounts to "tar but Windows-friendly".
// Good enough for text-mostly bundles that are already small; if we
// add binary artifacts later we can swap in the `zip` crate.
// ---------------------------------------------------------------------------

struct MiniZipWriter<'a, W: std::io::Write + std::io::Seek> {
    out: &'a mut W,
    entries: Vec<MiniZipEntry>,
}

struct MiniZipEntry {
    name: String,
    crc32: u32,
    size: u32,
    offset: u32,
}

impl<'a, W: std::io::Write + std::io::Seek> MiniZipWriter<'a, W> {
    fn new(out: &'a mut W) -> Self {
        Self {
            out,
            entries: Vec::new(),
        }
    }

    fn add_stored(&mut self, name: &str, data: &[u8]) -> std::io::Result<()> {
        let offset = self.out.stream_position()? as u32;
        let crc32 = crc32(data);
        let name_bytes = name.as_bytes();
        let size: u32 = data.len() as u32;

        // Local file header (4.3.7 in PKWARE APPNOTE)
        self.out.write_all(&0x04034b50u32.to_le_bytes())?;
        self.out.write_all(&20u16.to_le_bytes())?; // version needed
        self.out.write_all(&0u16.to_le_bytes())?; // flags
        self.out.write_all(&0u16.to_le_bytes())?; // method = STORE
        self.out.write_all(&0u16.to_le_bytes())?; // time
        self.out.write_all(&0u16.to_le_bytes())?; // date
        self.out.write_all(&crc32.to_le_bytes())?;
        self.out.write_all(&size.to_le_bytes())?; // compressed
        self.out.write_all(&size.to_le_bytes())?; // uncompressed
        self.out
            .write_all(&(name_bytes.len() as u16).to_le_bytes())?;
        self.out.write_all(&0u16.to_le_bytes())?; // extra len
        self.out.write_all(name_bytes)?;
        self.out.write_all(data)?;

        self.entries.push(MiniZipEntry {
            name: name.to_owned(),
            crc32,
            size,
            offset,
        });
        Ok(())
    }

    fn finish(&mut self) -> std::io::Result<()> {
        let central_dir_offset = self.out.stream_position()? as u32;
        for entry in &self.entries {
            let name_bytes = entry.name.as_bytes();
            self.out.write_all(&0x02014b50u32.to_le_bytes())?;
            self.out.write_all(&20u16.to_le_bytes())?; // version made by
            self.out.write_all(&20u16.to_le_bytes())?; // version needed
            self.out.write_all(&0u16.to_le_bytes())?; // flags
            self.out.write_all(&0u16.to_le_bytes())?; // method
            self.out.write_all(&0u16.to_le_bytes())?; // time
            self.out.write_all(&0u16.to_le_bytes())?; // date
            self.out.write_all(&entry.crc32.to_le_bytes())?;
            self.out.write_all(&entry.size.to_le_bytes())?;
            self.out.write_all(&entry.size.to_le_bytes())?;
            self.out
                .write_all(&(name_bytes.len() as u16).to_le_bytes())?;
            self.out.write_all(&0u16.to_le_bytes())?; // extra
            self.out.write_all(&0u16.to_le_bytes())?; // comment
            self.out.write_all(&0u16.to_le_bytes())?; // disk
            self.out.write_all(&0u16.to_le_bytes())?; // int attrs
            self.out.write_all(&0u32.to_le_bytes())?; // ext attrs
            self.out.write_all(&entry.offset.to_le_bytes())?;
            self.out.write_all(name_bytes)?;
        }
        let central_dir_end = self.out.stream_position()? as u32;
        let central_dir_size = central_dir_end - central_dir_offset;

        self.out.write_all(&0x06054b50u32.to_le_bytes())?;
        self.out.write_all(&0u16.to_le_bytes())?; // disk
        self.out.write_all(&0u16.to_le_bytes())?; // disk with cd
        self.out
            .write_all(&(self.entries.len() as u16).to_le_bytes())?;
        self.out
            .write_all(&(self.entries.len() as u16).to_le_bytes())?;
        self.out.write_all(&central_dir_size.to_le_bytes())?;
        self.out.write_all(&central_dir_offset.to_le_bytes())?;
        self.out.write_all(&0u16.to_le_bytes())?; // comment len
        Ok(())
    }
}

/// CRC-32/ISO-HDLC, the same polynomial PKZIP requires. Table is
/// built on first call.
fn crc32(data: &[u8]) -> u32 {
    use std::sync::OnceLock;
    static TABLE: OnceLock<[u32; 256]> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut table = [0u32; 256];
        for (i, slot) in table.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 == 1 {
                    0xEDB88320 ^ (c >> 1)
                } else {
                    c >> 1
                };
            }
            *slot = c;
        }
        table
    });
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        let idx = ((crc ^ byte as u32) & 0xFF) as usize;
        crc = table[idx] ^ (crc >> 8);
    }
    crc ^ 0xFFFFFFFF
}
