//! Unit tests for [`super::resolver`] and [`super::cache`].

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use aura_os_core::{ProjectId, SpecId, Task, TaskId, TaskStatus};
use chrono::Utc;

use super::cache::{TaskContextCache, MAX_CACHE_ENTRIES};
use super::resolver::{
    build_task_context, FetchedTask, TaskContextInputs, TaskContextResolver,
    MAX_EXECUTION_NOTES_LEN,
};
use crate::error::AutomationError;

fn task_with(title: &str, description: &str, status: TaskStatus) -> Task {
    let now = Utc::now();
    Task {
        task_id: TaskId::new(),
        project_id: ProjectId::new(),
        spec_id: SpecId::new(),
        title: title.to_string(),
        description: description.to_string(),
        status,
        order_index: 0,
        dependency_ids: Vec::new(),
        parent_task_id: None,
        skip_auto_decompose: false,
        assigned_agent_instance_id: None,
        completed_by_agent_instance_id: None,
        session_id: None,
        execution_notes: String::new(),
        files_changed: Vec::new(),
        live_output: String::new(),
        build_steps: Vec::new(),
        test_steps: Vec::new(),
        user_id: None,
        model: None,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: now,
        updated_at: now,
    }
}

#[test]
fn build_includes_title_description_status_and_version() {
    let task = task_with("Fix loop", "Repair the spinner", TaskStatus::Ready);
    let ctx = build_task_context(&TaskContextInputs {
        task: &task,
        parent: None,
        children: &[],
        spec: None,
        task_version: 7,
    });
    assert_eq!(ctx.task_id, task.task_id);
    assert_eq!(ctx.title, "Fix loop");
    assert_eq!(ctx.description, "Repair the spinner");
    assert_eq!(ctx.status, TaskStatus::Ready);
    assert_eq!(ctx.task_version, 7);
    assert!(ctx.spec.is_none());
    assert!(ctx.parent.is_none());
    assert!(ctx.children.is_empty());
    assert!(ctx.recent_execution_notes.is_none());
}

#[test]
fn build_drops_blank_spec_to_none() {
    let task = task_with("t", "d", TaskStatus::Ready);
    let ctx = build_task_context(&TaskContextInputs {
        task: &task,
        parent: None,
        children: &[],
        spec: Some("   "),
        task_version: 0,
    });
    assert!(
        ctx.spec.is_none(),
        "blank spec must serialise as None to keep the payload tight"
    );
}

#[test]
fn build_keeps_real_spec_trimmed() {
    let task = task_with("t", "d", TaskStatus::Ready);
    let ctx = build_task_context(&TaskContextInputs {
        task: &task,
        parent: None,
        children: &[],
        spec: Some("  hello world  "),
        task_version: 0,
    });
    assert_eq!(ctx.spec.as_deref(), Some("hello world"));
}

#[test]
fn build_emits_parent_and_children_refs() {
    let parent = task_with("Parent", "p-desc", TaskStatus::InProgress);
    let child_a = task_with("Child A", "ca-desc", TaskStatus::Ready);
    let child_b = task_with("Child B", "cb-desc", TaskStatus::Done);
    let task = task_with("Task", "t-desc", TaskStatus::InProgress);

    let ctx = build_task_context(&TaskContextInputs {
        task: &task,
        parent: Some(&parent),
        children: &[child_a.clone(), child_b.clone()],
        spec: None,
        task_version: 0,
    });

    let parent_ref = ctx.parent.as_ref().expect("parent ref must be populated");
    assert_eq!(parent_ref.task_id, parent.task_id);
    assert_eq!(parent_ref.title, "Parent");
    assert_eq!(parent_ref.status, TaskStatus::InProgress);

    assert_eq!(ctx.children.len(), 2);
    assert_eq!(ctx.children[0].task_id, child_a.task_id);
    assert_eq!(ctx.children[0].title, "Child A");
    assert_eq!(ctx.children[1].task_id, child_b.task_id);
    assert_eq!(ctx.children[1].status, TaskStatus::Done);
}

#[test]
fn build_truncates_long_execution_notes_with_ellipsis() {
    let mut task = task_with("t", "d", TaskStatus::Failed);
    let long_note: String = "A".repeat(MAX_EXECUTION_NOTES_LEN + 50);
    task.execution_notes = long_note;
    let ctx = build_task_context(&TaskContextInputs {
        task: &task,
        parent: None,
        children: &[],
        spec: None,
        task_version: 0,
    });
    let notes = ctx
        .recent_execution_notes
        .expect("execution_notes must surface when populated");
    assert!(
        notes.starts_with('…'),
        "truncated tail must lead with the ellipsis sentinel: {notes:?}"
    );
    assert_eq!(
        notes.chars().count(),
        MAX_EXECUTION_NOTES_LEN,
        "post-truncation length must clamp at MAX_EXECUTION_NOTES_LEN"
    );
}

#[test]
fn build_drops_whitespace_only_execution_notes() {
    let mut task = task_with("t", "d", TaskStatus::Failed);
    task.execution_notes = "   \n\t   ".to_string();
    let ctx = build_task_context(&TaskContextInputs {
        task: &task,
        parent: None,
        children: &[],
        spec: None,
        task_version: 0,
    });
    assert!(ctx.recent_execution_notes.is_none());
}

#[test]
fn cache_hit_avoids_second_fetch() {
    let resolver = TaskContextResolver::new();
    let task = task_with("Cached", "desc", TaskStatus::Ready);
    let task_id = task.task_id;
    let calls = Arc::new(AtomicUsize::new(0));
    let fetcher = {
        let task = task.clone();
        let calls = calls.clone();
        move |_id: TaskId| -> Result<FetchedTask, AutomationError> {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(FetchedTask {
                task: task.clone(),
                parent: None,
                children: Vec::new(),
                spec: None,
            })
        }
    };

    let first = resolver
        .resolve(task_id, 1, &fetcher)
        .expect("first call must succeed");
    let second = resolver
        .resolve(task_id, 1, &fetcher)
        .expect("second call must succeed");
    assert!(
        Arc::ptr_eq(&first, &second),
        "cache hit must return the same Arc",
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "fetcher must run exactly once for a cached (task_id, version)",
    );
}

#[test]
fn version_bump_invalidates_cache() {
    let resolver = TaskContextResolver::new();
    let task = task_with("Versioned", "desc", TaskStatus::Ready);
    let task_id = task.task_id;
    let calls = Arc::new(AtomicUsize::new(0));
    let fetcher = {
        let task = task.clone();
        let calls = calls.clone();
        move |_id: TaskId| -> Result<FetchedTask, AutomationError> {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(FetchedTask {
                task: task.clone(),
                parent: None,
                children: Vec::new(),
                spec: None,
            })
        }
    };

    let _v1 = resolver
        .resolve(task_id, 1, &fetcher)
        .expect("v1 must succeed");
    let _v2 = resolver
        .resolve(task_id, 2, &fetcher)
        .expect("v2 must succeed");
    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "version bump must miss the cache and re-fetch",
    );
}

#[test]
fn fetcher_error_propagates_and_does_not_cache() {
    let resolver = TaskContextResolver::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let task_id = TaskId::new();
    let fetcher = {
        let calls = calls.clone();
        move |_id: TaskId| -> Result<FetchedTask, AutomationError> {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(AutomationError::InvalidHarnessEvent {
                detail: "stub failure".to_string(),
            })
        }
    };
    let first = resolver.resolve(task_id, 0, &fetcher);
    assert!(first.is_err());
    let _ = resolver.resolve(task_id, 0, &fetcher);
    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "errors must not poison the cache: a retry must hit the fetcher again",
    );
    assert_eq!(
        resolver.cache().len(),
        0,
        "cache must remain empty after failed fetches",
    );
}

#[test]
fn cache_evicts_oldest_when_over_capacity() {
    let cache = TaskContextCache::new();
    let mut keys = Vec::new();
    for n in 0..(MAX_CACHE_ENTRIES + 5) {
        let task = task_with("t", "d", TaskStatus::Ready);
        let task_id = task.task_id;
        let ctx = build_task_context(&TaskContextInputs {
            task: &task,
            parent: None,
            children: &[],
            spec: None,
            task_version: n as u64,
        });
        cache.insert(task_id, n as u64, Arc::new(ctx));
        keys.push((task_id, n as u64));
    }
    assert_eq!(
        cache.len(),
        MAX_CACHE_ENTRIES,
        "cache must clamp at MAX_CACHE_ENTRIES after over-fill",
    );
    let oldest_kept = keys[5];
    assert!(
        cache.get(oldest_kept.0, oldest_kept.1).is_some(),
        "the oldest surviving entry must still be resolvable",
    );
    let evicted = keys[0];
    assert!(
        cache.get(evicted.0, evicted.1).is_none(),
        "the oldest-by-insertion entry must have been evicted",
    );
}

#[test]
fn re_inserting_existing_key_updates_value_in_place() {
    let cache = TaskContextCache::new();
    let task = task_with("t", "d", TaskStatus::Ready);
    let task_id = task.task_id;
    let v1 = build_task_context(&TaskContextInputs {
        task: &task,
        parent: None,
        children: &[],
        spec: None,
        task_version: 1,
    });
    cache.insert(task_id, 1, Arc::new(v1));

    // Mutate description before re-inserting under the same key.
    let mut task2 = task.clone();
    task2.description = "updated".to_string();
    let v2 = build_task_context(&TaskContextInputs {
        task: &task2,
        parent: None,
        children: &[],
        spec: None,
        task_version: 1,
    });
    cache.insert(task_id, 1, Arc::new(v2));

    let stored = cache.get(task_id, 1).expect("entry must still be resident");
    assert_eq!(stored.description, "updated");
    assert_eq!(cache.len(), 1, "re-insertion must not inflate the cache");
}

#[test]
fn empty_description_serialises_cleanly() {
    let task = task_with("t", "", TaskStatus::Ready);
    let ctx = build_task_context(&TaskContextInputs {
        task: &task,
        parent: None,
        children: &[],
        spec: None,
        task_version: 0,
    });
    let json = serde_json::to_value(&ctx).expect("context must serialise");
    assert_eq!(json.get("description").and_then(|v| v.as_str()), Some(""));
    assert_eq!(json.get("spec"), Some(&serde_json::Value::Null));
    assert_eq!(
        json.get("recent_execution_notes"),
        Some(&serde_json::Value::Null)
    );
}
