use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use tracing::{debug, warn};

#[derive(Debug, Clone, serde::Serialize)]
pub struct SuperAgentEvent {
    pub event_type: String,
    pub summary: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub data: serde_json::Value,
}

pub struct SuperAgentEventListener {
    events: Arc<Mutex<Vec<SuperAgentEvent>>>,
    max_events: usize,
}

impl SuperAgentEventListener {
    pub fn new(max_events: usize) -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
            max_events,
        }
    }

    pub fn spawn(&self, mut rx: broadcast::Receiver<serde_json::Value>) {
        let events = self.events.clone();
        let max = self.max_events;
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(value) => {
                        if let Some(evt) = classify_event(&value) {
                            let mut buf = events.lock().await;
                            buf.push(evt);
                            if buf.len() > max {
                                let excess = buf.len() - max;
                                buf.drain(0..excess);
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!(skipped = n, "SuperAgent event listener lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("Event broadcast closed, stopping SuperAgent listener");
                        break;
                    }
                }
            }
        });
    }

    pub async fn drain_events(&self) -> Vec<SuperAgentEvent> {
        let mut buf = self.events.lock().await;
        std::mem::take(&mut *buf)
    }

    pub async fn peek_events(&self) -> Vec<SuperAgentEvent> {
        self.events.lock().await.clone()
    }
}

fn classify_event(value: &serde_json::Value) -> Option<SuperAgentEvent> {
    let event_type = value.get("type").and_then(|t| t.as_str())?;
    let now = chrono::Utc::now();

    let (filtered_type, summary) = match event_type {
        "loop_finished" | "loop_stopped" | "loop_completed" => {
            let project = value
                .get("project_name")
                .and_then(|p| p.as_str())
                .unwrap_or("unknown");
            (
                event_type.to_string(),
                format!("Dev loop finished for project '{project}'"),
            )
        }
        "task_completed" | "task_done" => {
            let title = value
                .get("task_title")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown");
            (event_type.to_string(), format!("Task completed: {title}"))
        }
        "task_failed" => {
            let title = value
                .get("task_title")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown");
            (event_type.to_string(), format!("Task failed: {title}"))
        }
        "agent_error" | "agent_instance_updated" => {
            let status = value.get("status").and_then(|s| s.as_str()).unwrap_or("");
            if status == "error" {
                let name = value
                    .get("agent_name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("unknown");
                (
                    "agent_error".to_string(),
                    format!("Agent '{name}' encountered an error"),
                )
            } else {
                return None;
            }
        }
        "git_committed" | "git_pushed" => {
            let project = value
                .get("project_name")
                .and_then(|p| p.as_str())
                .unwrap_or("unknown");
            (
                event_type.to_string(),
                format!("Git {event_type} in project '{project}'"),
            )
        }
        "credit_low" | "budget_alert" => (
            "budget_alert".to_string(),
            "Credit balance is running low".to_string(),
        ),
        "cron_job_started" => {
            let name = value
                .get("job_name")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown");
            (
                event_type.to_string(),
                format!("Cron job started: {name}"),
            )
        }
        "cron_job_completed" => {
            let name = value
                .get("job_name")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown");
            let artifacts = value
                .get("artifacts_count")
                .and_then(|n| n.as_u64())
                .unwrap_or(0);
            (
                event_type.to_string(),
                format!("Cron job completed: {name} ({artifacts} artifacts)"),
            )
        }
        "cron_job_failed" => {
            let name = value
                .get("job_name")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown");
            let error = value
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("unknown error");
            (
                event_type.to_string(),
                format!("Cron job failed: {name} - {error}"),
            )
        }
        "process_run_started" => {
            let pid = value
                .get("process_id")
                .and_then(|p| p.as_str())
                .unwrap_or("unknown");
            (event_type.to_string(), format!("Process run started: {pid}"))
        }
        "process_run_completed" => {
            let pid = value
                .get("process_id")
                .and_then(|p| p.as_str())
                .unwrap_or("unknown");
            (
                event_type.to_string(),
                format!("Process run completed: {pid}"),
            )
        }
        "process_node_executed" => {
            let node_type = value
                .get("node_type")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown");
            let node_id = value
                .get("node_id")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown");
            (
                event_type.to_string(),
                format!("Process node executed: {node_type} ({node_id})"),
            )
        }
        _ => return None,
    };

    Some(SuperAgentEvent {
        event_type: filtered_type,
        summary,
        timestamp: now,
        data: value.clone(),
    })
}
