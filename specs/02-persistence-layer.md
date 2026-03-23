# Spec 02 — Persistence Layer

## Purpose

Provide a storage abstraction over RocksDB that the rest of the application uses to persist and query all domain entities. This layer owns the database lifecycle (open, close, backup), key encoding scheme, CRUD operations, prefix-based scans, and atomic batch writes. No domain logic lives here — only serialization-to-bytes and key-routing.

---

## Core Concepts

### Column Families

RocksDB column families act as logical tables. Each entity type gets its own column family for isolation and independent tuning.

| Column Family | Stores |
|---------------|--------|
| `projects` | `Project` entities |
| `specs` | `Spec` entities |
| `tasks` | `Task` entities |
| `agents` | `Agent` entities |
| `sessions` | `Session` entities |
| `settings` | Encrypted API keys and app configuration |

### Hierarchical Key Encoding

Keys encode the ownership hierarchy so that prefix scans retrieve all children of a parent efficiently. Keys are UTF-8 strings using `:` as a separator.

| Entity | Key Pattern | Example |
|--------|-------------|---------|
| Project | `{project_id}` | `a1b2c3d4-...` |
| Spec | `{project_id}:{spec_id}` | `a1b2c3d4-...:e5f6g7h8-...` |
| Task | `{project_id}:{spec_id}:{task_id}` | `a1b2c3d4-...:e5f6g7h8-...:i9j0k1l2-...` |
| Agent | `{project_id}:{agent_id}` | `a1b2c3d4-...:m3n4o5p6-...` |
| Session | `{project_id}:{agent_id}:{session_id}` | `a1b2c3d4-...:m3n4o5p6-...:q7r8s9t0-...` |
| Settings | `{key}` | `claude_api_key` |

### Value Encoding

All values are serialized as JSON bytes via `serde_json::to_vec` / `serde_json::from_slice`. JSON is chosen over a binary format for debuggability in the MVP; migration to a binary format (e.g., bincode) is a future optimization.

### Atomic Batch Writes

When multiple entities must be written together (e.g., creating a spec and its tasks), the store uses `WriteBatch` to ensure atomicity.

---

## Interfaces

### Store Trait

```rust
use crate::{
    Agent, AgentId, Project, ProjectId, Session, SessionId,
    Spec, SpecId, Task, TaskId,
};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("entity not found: {0}")]
    NotFound(String),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("database error: {0}")]
    Database(#[from] rocksdb::Error),
    #[error("key encoding error: {0}")]
    KeyEncoding(String),
}

pub type StoreResult<T> = Result<T, StoreError>;
```

### RocksStore Implementation

```rust
use rocksdb::{DB, Options, ColumnFamilyDescriptor, WriteBatch};
use std::path::Path;
use std::sync::Arc;

pub struct RocksStore {
    db: Arc<DB>,
}

impl RocksStore {
    /// Open or create the database at the given path.
    /// Creates all column families if they don't exist.
    pub fn open(path: &Path) -> StoreResult<Self> { /* ... */ }

    /// Close the database gracefully.
    pub fn close(self) { /* drop */ }
}
```

### Per-Entity Operations

Each entity follows the same CRUD pattern. Shown here for `Project`; the others are identical in shape.

```rust
impl RocksStore {
    // --- Project ---

    pub fn put_project(&self, project: &Project) -> StoreResult<()> {
        let key = project.project_id.to_string();
        let value = serde_json::to_vec(project)?;
        self.db.put_cf(&self.cf_projects(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_project(&self, id: &ProjectId) -> StoreResult<Project> {
        let key = id.to_string();
        let bytes = self.db
            .get_cf(&self.cf_projects(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("project:{id}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_project(&self, id: &ProjectId) -> StoreResult<()> {
        let key = id.to_string();
        self.db.delete_cf(&self.cf_projects(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_projects(&self) -> StoreResult<Vec<Project>> {
        self.scan_cf::<Project>(&self.cf_projects(), None)
    }

    // --- Spec ---

    pub fn put_spec(&self, spec: &Spec) -> StoreResult<()> {
        let key = format!("{}:{}", spec.project_id, spec.spec_id);
        let value = serde_json::to_vec(spec)?;
        self.db.put_cf(&self.cf_specs(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_spec(&self, project_id: &ProjectId, spec_id: &SpecId) -> StoreResult<Spec> {
        let key = format!("{project_id}:{spec_id}");
        let bytes = self.db
            .get_cf(&self.cf_specs(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("spec:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn list_specs_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Spec>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Spec>(&self.cf_specs(), Some(&prefix))
    }

    // --- Task ---

    pub fn put_task(&self, task: &Task) -> StoreResult<()> {
        let key = format!("{}:{}:{}", task.project_id, task.spec_id, task.task_id);
        let value = serde_json::to_vec(task)?;
        self.db.put_cf(&self.cf_tasks(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> StoreResult<Task> {
        let key = format!("{project_id}:{spec_id}:{task_id}");
        let bytes = self.db
            .get_cf(&self.cf_tasks(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("task:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn list_tasks_by_spec(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
    ) -> StoreResult<Vec<Task>> {
        let prefix = format!("{project_id}:{spec_id}:");
        self.scan_cf::<Task>(&self.cf_tasks(), Some(&prefix))
    }

    pub fn list_tasks_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Task>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Task>(&self.cf_tasks(), Some(&prefix))
    }

    // --- Agent ---

    pub fn put_agent(&self, agent: &Agent) -> StoreResult<()> {
        let key = format!("{}:{}", agent.project_id, agent.agent_id);
        let value = serde_json::to_vec(agent)?;
        self.db.put_cf(&self.cf_agents(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_agent(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
    ) -> StoreResult<Agent> {
        let key = format!("{project_id}:{agent_id}");
        let bytes = self.db
            .get_cf(&self.cf_agents(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("agent:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn list_agents_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Agent>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Agent>(&self.cf_agents(), Some(&prefix))
    }

    // --- Session ---

    pub fn put_session(&self, session: &Session) -> StoreResult<()> {
        let key = format!(
            "{}:{}:{}",
            session.project_id, session.agent_id, session.session_id
        );
        let value = serde_json::to_vec(session)?;
        self.db.put_cf(&self.cf_sessions(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_session(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        session_id: &SessionId,
    ) -> StoreResult<Session> {
        let key = format!("{project_id}:{agent_id}:{session_id}");
        let bytes = self.db
            .get_cf(&self.cf_sessions(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("session:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn list_sessions_by_agent(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
    ) -> StoreResult<Vec<Session>> {
        let prefix = format!("{project_id}:{agent_id}:");
        self.scan_cf::<Session>(&self.cf_sessions(), Some(&prefix))
    }
}
```

### Generic Prefix Scan Helper

```rust
impl RocksStore {
    fn scan_cf<T: serde::de::DeserializeOwned>(
        &self,
        cf: &impl AsColumnFamilyRef,
        prefix: Option<&str>,
    ) -> StoreResult<Vec<T>> {
        let iter = match prefix {
            Some(p) => self.db.prefix_iterator_cf(cf, p.as_bytes()),
            None => self.db.full_iterator_cf(cf, rocksdb::IteratorMode::Start),
        };

        let mut results = Vec::new();
        for item in iter {
            let (key, value) = item?;
            if let Some(p) = prefix {
                if !key.starts_with(p.as_bytes()) {
                    break;
                }
            }
            results.push(serde_json::from_slice(&value)?);
        }
        Ok(results)
    }
}
```

### Batch Write Helper

```rust
impl RocksStore {
    pub fn write_batch(&self, ops: Vec<BatchOp>) -> StoreResult<()> {
        let mut batch = WriteBatch::default();
        for op in ops {
            match op {
                BatchOp::Put { cf, key, value } => {
                    batch.put_cf(&self.cf_handle(&cf), key.as_bytes(), &value);
                }
                BatchOp::Delete { cf, key } => {
                    batch.delete_cf(&self.cf_handle(&cf), key.as_bytes());
                }
            }
        }
        self.db.write(batch)?;
        Ok(())
    }
}

pub enum BatchOp {
    Put {
        cf: ColumnFamilyName,
        key: String,
        value: Vec<u8>,
    },
    Delete {
        cf: ColumnFamilyName,
        key: String,
    },
}

#[derive(Debug, Clone, Copy)]
pub enum ColumnFamilyName {
    Projects,
    Specs,
    Tasks,
    Agents,
    Sessions,
    Settings,
}
```

### Database Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Open : RocksStore::open(path)
    Open --> Open : read / write operations
    Open --> Closed : RocksStore::close() or drop
    Closed --> [*]
```

---

## Key Behaviors

1. **Prefix isolation** — a scan for `project_id_A:` never returns entities belonging to `project_id_B` because UUID strings don't share prefixes.
2. **Sorted iteration** — RocksDB stores keys in lexicographic order. Within a prefix scan, entities appear in UUID order (not insertion order). The application layer sorts by `order_index` or `created_at` when presentation order matters.
3. **Column family creation** — all 6 column families are created on first `open()`. If the DB already exists, missing CFs are added; existing ones are preserved.
4. **Crash safety** — RocksDB's WAL ensures that committed writes survive process crashes. `WriteBatch` ensures multi-key atomicity.
5. **No migrations (MVP)** — since values are JSON and deserialization uses `#[serde(default)]` on new fields, schema evolution is handled at the serde level for now. A migration framework is out of scope.
6. **Thread safety** — `RocksStore` wraps `DB` in `Arc` and is `Send + Sync`. Multiple threads can read/write concurrently; RocksDB handles internal locking.

---

## Dependencies

| Spec | What is used |
|------|-------------|
| Spec 01 | All entity structs, ID types, enums |

**External crates:**

| Crate | Version | Purpose |
|-------|---------|---------|
| `rocksdb` | 0.22.x | Embedded key-value store |
| `serde_json` | 1.x | Value serialization |
| `thiserror` | 1.x | `StoreError` definition |
| `tempfile` | 3.x | Temp directories for tests |

---

## Tasks

| ID | Task | Description |
|----|------|-------------|
| T02.1 | Create `aura-os-store` crate | `cargo new aura-os-store --lib`, add to workspace, add `aura-os-core` and `rocksdb` dependencies |
| T02.2 | Implement `RocksStore::open` | Open DB at path, create all 6 column families, return `RocksStore` |
| T02.3 | Implement column family helpers | Private `cf_projects()`, `cf_specs()`, etc. methods returning CF handles |
| T02.4 | Implement `scan_cf` generic helper | Prefix iterator with deserialization and prefix-boundary check |
| T02.5 | Implement Project CRUD | `put_project`, `get_project`, `delete_project`, `list_projects` |
| T02.6 | Implement Spec CRUD | `put_spec`, `get_spec`, `delete_spec`, `list_specs_by_project` |
| T02.7 | Implement Task CRUD | `put_task`, `get_task`, `delete_task`, `list_tasks_by_spec`, `list_tasks_by_project` |
| T02.8 | Implement Agent CRUD | `put_agent`, `get_agent`, `delete_agent`, `list_agents_by_project` |
| T02.9 | Implement Session CRUD | `put_session`, `get_session`, `delete_session`, `list_sessions_by_agent` |
| T02.10 | Implement `write_batch` | Atomic multi-key writes across column families |
| T02.11 | Implement Settings CRUD | `put_setting`, `get_setting`, `delete_setting` — raw bytes key/value in settings CF |
| T02.12 | Integration tests — CRUD per entity | For each entity: create, read back, update, delete, verify not-found |
| T02.13 | Integration tests — prefix scans | Create multiple specs/tasks under different projects, verify scans return correct subsets |
| T02.14 | Integration tests — batch writes | Write spec + tasks atomically, verify all-or-nothing |
| T02.15 | Clippy + fmt clean | `cargo clippy -p aura-os-store -- -D warnings` and `cargo fmt` |

---

## Test Criteria

All of the following must pass before proceeding to Spec 03:

- [ ] `cargo build -p aura-os-store` compiles with zero warnings
- [ ] `cargo test -p aura-os-store` passes all tests (uses `tempfile` for DB path)
- [ ] CRUD round-trip works for every entity type
- [ ] Prefix scans return exactly the expected subset
- [ ] Batch writes are atomic (all written or none)
- [ ] `StoreError::NotFound` returned for missing entities
- [ ] Database can be opened, closed, and reopened without data loss
- [ ] Clippy and fmt are clean
