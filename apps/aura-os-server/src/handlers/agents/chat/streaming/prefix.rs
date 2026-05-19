//! `build_sse_stream`: prepends fork / connecting / queued progress
//! events to a harness broadcast bridge, in that exact order, so the
//! client sees the auto-fork session swap before any other prefix or
//! broadcast event.

use std::convert::Infallible;
use std::sync::Arc;

use aura_os_harness::HarnessOutbound;
use axum::response::sse::Event;
use futures_util::stream;
use futures_util::StreamExt as FuturesStreamExt;

use crate::stability_metrics::StabilityMetrics;

use super::super::persist::ForkInfo;
use super::bridge::harness_broadcast_to_sse;

pub(super) fn build_sse_stream(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    is_new: bool,
    was_queued: bool,
    fork_info: Option<ForkInfo>,
    metrics: Option<Arc<StabilityMetrics>>,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    let mut prefix: Vec<Result<Event, Infallible>> = Vec::new();
    // Phase 3 auto-fork: emit the `forked_for_context` event FIRST so
    // the chat panel can swap `?session=<old>` → `?session=<new>` and
    // mount its one-shot soft banner before `connecting` / `queued`
    // arrive. Older clients that don't recognise the stage gracefully
    // ignore the event (the progress dispatcher is a switch on
    // `stage` strings).
    if let Some(fork) = fork_info {
        // SSE wire shape stays string-typed for both session ids
        // (frontend matcher and `?session=` URL swap both expect raw
        // strings); stringify the typed `SessionId` here at the emit
        // boundary.
        if let Ok(forked_event) = Event::default()
            .event("progress")
            .json_data(serde_json::json!({
                "type": "progress",
                "stage": "forked_for_context",
                "previous_session_id": fork.previous_session_id.to_string(),
                "new_session_id": fork.new_session_id.to_string(),
                "message": "Continued from previous chat — context was filling up",
            }))
        {
            prefix.push(Ok(forked_event));
        }
    }
    if is_new {
        if let Ok(progress_event) = Event::default()
            .event("progress")
            .json_data(serde_json::json!({"type":"progress","stage":"connecting"}))
        {
            prefix.push(Ok(progress_event));
        }
    }
    if was_queued {
        // Surface the "your message is waiting behind the previous
        // turn" hint as a structured SSE progress event so the UI
        // can render distinct copy from `connecting`. Phase 4 wires
        // this into the chat composer; until then the event is a
        // no-op for older clients that ignore unknown progress
        // stages.
        if let Ok(progress_event) =
            Event::default()
                .event("progress")
                .json_data(serde_json::json!({
                    "type":"progress",
                    "stage":"queued",
                    "message":"Queued behind current turn",
                }))
        {
            prefix.push(Ok(progress_event));
        }
    }
    let broadcast_stream = harness_broadcast_to_sse(rx, metrics);
    FuturesStreamExt::chain(stream::iter(prefix), broadcast_stream)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use aura_os_harness::{
        AssistantMessageEnd, FilesChanged, HarnessOutbound, SessionUsage, TextDelta,
    };
    use futures_util::StreamExt;
    use tokio::sync::{broadcast, Mutex};

    use super::super::super::persist::ForkInfo;
    use super::super::super::turn_slot::acquire_turn_slot;
    use super::build_sse_stream;

    fn end_event() -> HarnessOutbound {
        HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: "msg-1".into(),
            stop_reason: "stop".into(),
            usage: SessionUsage::default(),
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        })
    }

    fn text_delta(text: &str) -> HarnessOutbound {
        HarnessOutbound::TextDelta(TextDelta {
            text: text.to_string(),
        })
    }

    fn dump(event: &axum::response::sse::Event) -> String {
        format!("{:?}", event)
    }

    #[tokio::test]
    async fn build_sse_stream_prepends_queued_progress_when_was_queued() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("hello")).expect("seed text delta");
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(
            rx, /* is_new */ false, /* was_queued */ true, /* fork_info */ None,
            /* metrics */ None,
        );
        tokio::pin!(stream);
        let first = stream
            .next()
            .await
            .expect("queued prefix event")
            .expect("first item is Ok");
        let body = dump(&first);
        assert!(
            body.contains("queued"),
            "first event must be the queued progress event, got: {body}"
        );
        assert!(
            body.contains("Queued behind current turn"),
            "queued event must include the human-readable hint, got: {body}"
        );
        // The prepended queued event must come BEFORE any forwarded
        // text delta — that's the whole UX contract for Phase 3.
        let second = stream
            .next()
            .await
            .expect("forwarded text delta")
            .expect("second item is Ok");
        assert!(
            dump(&second).contains("hello"),
            "second event must be the broadcast text delta"
        );
    }

    #[tokio::test]
    async fn build_sse_stream_omits_queued_progress_when_not_queued() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("hello")).expect("seed text delta");
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(
            rx, /* is_new */ false, /* was_queued */ false, /* fork_info */ None,
            /* metrics */ None,
        );
        tokio::pin!(stream);
        let first = stream
            .next()
            .await
            .expect("first event")
            .expect("first item is Ok");
        let body = dump(&first);
        assert!(
            !body.contains("queued"),
            "no prefix event must precede the broadcast when was_queued=false, got: {body}"
        );
    }

    /// Phase 3 auto-fork guard: when `fork_info` is set, the stream
    /// must lead with the `progress: forked_for_context` event
    /// (carrying both the previous and new session ids) BEFORE any
    /// other prefix or broadcast event so the chat panel can swap
    /// `?session=` and surface the soft banner before the assistant
    /// turn starts streaming.
    #[tokio::test]
    async fn build_sse_stream_prepends_forked_for_context_when_fork_info_set() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("after-fork")).expect("seed text delta");
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(
            rx,
            /* is_new */ true,
            /* was_queued */ false,
            Some(ForkInfo {
                previous_session_id: "00000000-0000-0000-0000-000000000aaa"
                    .parse()
                    .expect("static UUID literal parses as SessionId"),
                new_session_id: "00000000-0000-0000-0000-000000000bbb"
                    .parse()
                    .expect("static UUID literal parses as SessionId"),
            }),
            /* metrics */ None,
        );
        tokio::pin!(stream);

        let first = dump(
            &stream
                .next()
                .await
                .expect("forked progress event")
                .expect("ok"),
        );
        assert!(
            first.contains("forked_for_context"),
            "first event must be the forked_for_context progress event, got: {first}"
        );
        assert!(
            first.contains("00000000-0000-0000-0000-000000000aaa"),
            "forked event must carry the previous session id, got: {first}"
        );
        assert!(
            first.contains("00000000-0000-0000-0000-000000000bbb"),
            "forked event must carry the new session id, got: {first}"
        );

        let second = dump(
            &stream
                .next()
                .await
                .expect("connecting event after fork")
                .expect("ok"),
        );
        assert!(
            second.contains("connecting"),
            "connecting prefix must follow the forked_for_context event, got: {second}"
        );
    }

    #[tokio::test]
    async fn build_sse_stream_emits_both_connecting_and_queued_when_set() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(
            rx, /* is_new */ true, /* was_queued */ true, /* fork_info */ None,
            /* metrics */ None,
        );
        tokio::pin!(stream);
        let first = dump(&stream.next().await.expect("connecting event").expect("ok"));
        let second = dump(&stream.next().await.expect("queued event").expect("ok"));
        assert!(
            first.contains("connecting"),
            "is_new must emit `connecting` before `queued`, got: {first}"
        );
        assert!(
            second.contains("queued"),
            "queued event must follow the connecting event, got: {second}"
        );
    }

    /// End-to-end-ish guard for the queued-turn UX: two back-to-back
    /// acquirers on the same partition slot, with the second one's
    /// SSE stream built using its `was_queued` flag. The first
    /// acquirer holds the slot; the second is unblocked only after
    /// the first releases. The second must observe `queued = true`
    /// AND its build_sse_stream output must lead with the queued
    /// progress event before the first text delta arrives.
    #[tokio::test]
    async fn back_to_back_partition_sends_queue_with_progress_event() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));

        let first = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("first acquire");
        assert!(!first.queued, "first acquire on a fresh slot is not queued");

        let slot_2 = Arc::clone(&slot);
        let counter_2 = Arc::clone(&counter);
        let second_handle = tokio::spawn(async move { acquire_turn_slot(slot_2, counter_2).await });

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            !second_handle.is_finished(),
            "second send must wait while the first holds the slot",
        );
        assert_eq!(
            counter.load(Ordering::Acquire),
            2,
            "both acquirers must be counted while the second is queued",
        );

        drop(first.guard);

        let second = tokio::time::timeout(Duration::from_millis(200), second_handle)
            .await
            .expect("second acquire timed out")
            .expect("join handle")
            .expect("second acquire");
        assert!(
            second.queued,
            "second back-to-back send must observe queued = true",
        );

        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("second-turn")).expect("seed delta");
        tx.send(end_event()).expect("seed end");
        drop(tx);

        let stream = build_sse_stream(rx, /* is_new */ false, second.queued, None, None);
        tokio::pin!(stream);
        let first_evt = dump(
            &stream
                .next()
                .await
                .expect("queued prefix event")
                .expect("ok"),
        );
        let next_evt = dump(
            &stream
                .next()
                .await
                .expect("forwarded text delta")
                .expect("ok"),
        );
        assert!(
            first_evt.contains("queued"),
            "queued progress event must precede the forwarded text delta",
        );
        assert!(
            next_evt.contains("second-turn"),
            "forwarded broadcast event must follow the queued prefix",
        );

        drop(second.guard);
        assert_eq!(
            counter.load(Ordering::Acquire),
            0,
            "both guards dropped should leave the counter at zero",
        );
    }
}
