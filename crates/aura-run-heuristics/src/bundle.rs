use std::fs;
use std::io;
use std::path::Path;

use aura_loop_log_schema::RunMetadata;
use serde_json::Value;

/// An in-memory view over a single run bundle on disk.
///
/// Every JSONL file is pre-parsed into `Vec<Value>` for the raw inner
/// events (the `_ts` / `event` envelope that `loop_log.rs` writes is
/// unwrapped here so rule code can reach for `.get("type")` directly).
/// Missing files are treated as empty — every downstream reader
/// tolerates bundles that stopped writing mid-flight.
#[derive(Debug, Clone)]
pub struct BundleView {
    pub metadata: RunMetadata,
    pub events: Vec<Value>,
    pub llm_calls: Vec<Value>,
    pub iterations: Vec<Value>,
    pub blockers: Vec<Value>,
    pub retries: Vec<Value>,
}

/// Load a run bundle from disk. Reads `metadata.json` (required) and
/// every known `.jsonl` file (optional — missing or empty files
/// produce empty vectors).
pub fn load_bundle(dir: &Path) -> io::Result<BundleView> {
    let raw = fs::read(dir.join("metadata.json"))?;
    let metadata: RunMetadata = serde_json::from_slice(&raw)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    Ok(BundleView {
        metadata,
        events: read_jsonl(&dir.join("events.jsonl"))?,
        llm_calls: read_jsonl(&dir.join("llm_calls.jsonl"))?,
        iterations: read_jsonl(&dir.join("iterations.jsonl"))?,
        blockers: read_jsonl(&dir.join("blockers.jsonl"))?,
        retries: read_jsonl(&dir.join("retries.jsonl"))?,
    })
}

/// Parse a JSONL file, unwrapping the `{"_ts":…, "event":{…}}` envelope
/// written by `loop_log.rs`. Lines that aren't wrapped (older bundles,
/// manual fixtures) are returned verbatim. Malformed lines are skipped
/// with no error — a single truncated tail line shouldn't poison an
/// otherwise usable bundle.
fn read_jsonl(path: &Path) -> io::Result<Vec<Value>> {
    let content = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut out = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        out.push(unwrap_envelope(value));
    }
    Ok(out)
}

fn unwrap_envelope(value: Value) -> Value {
    match value {
        Value::Object(mut map) if map.contains_key("event") && map.contains_key("_ts") => {
            map.remove("event").unwrap_or(Value::Null)
        }
        other => other,
    }
}
