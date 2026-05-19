//! `SseDropGuardStream`: wraps an SSE event stream so that whenever
//! axum drops the response (normal turn-end or client disconnect),
//! the registered `on_drop` closure runs exactly once. The closure is
//! the server-side hook that catches both `Stop` and a browser refresh
//! and fires the turn-slot's early-release oneshot so a stuck plan-mode
//! turn no longer wedges the partition.

use std::convert::Infallible;
use std::pin::Pin;
use std::task::{Context, Poll};

use axum::response::sse::Event;
use futures_core::Stream;

/// SSE stream wrapper that runs `on_drop` exactly once when the inner
/// stream is dropped (either because it ended naturally or because
/// axum dropped the response after the client disconnected). This is
/// the server-side hook that catches both `Stop` and a browser
/// refresh: in both cases axum drops the boxed `Sse` body, which
/// drops this guard, which fires the early-release oneshot that
/// `spawn_turn_slot_release` is selecting on.
///
/// Wraps the existing `Stream<Item = Result<Event, Infallible>>`
/// produced by `build_sse_stream` without changing item types, so
/// the type plumbing through `SseStream` / `Sse::new` stays
/// transparent. Pinning safety: the inner stream is structurally
/// pinned via the inherent `pin_project_lite`-style projection below
/// (we rely on `inner: S` being the only `!Unpin` field).
pub(super) struct SseDropGuardStream<S, F: FnOnce()> {
    inner: S,
    on_drop: Option<F>,
}

impl<S, F: FnOnce()> SseDropGuardStream<S, F> {
    pub(super) fn new(inner: S, on_drop: F) -> Self {
        Self {
            inner,
            on_drop: Some(on_drop),
        }
    }
}

impl<S, F: FnOnce()> Drop for SseDropGuardStream<S, F> {
    fn drop(&mut self) {
        if let Some(f) = self.on_drop.take() {
            f();
        }
    }
}

impl<S, F> Stream for SseDropGuardStream<S, F>
where
    S: Stream<Item = Result<Event, Infallible>>,
    F: FnOnce(),
{
    type Item = Result<Event, Infallible>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        // SAFETY: `inner` is structurally pinned — the only `!Unpin`
        // field — and `on_drop: Option<F>` is `Unpin` regardless of
        // `F` because `Option` only holds `F` by value. We never move
        // `inner` out of `self` (`Drop` only takes `on_drop`), so this
        // projection is sound.
        let this = unsafe { self.get_unchecked_mut() };
        let inner = unsafe { Pin::new_unchecked(&mut this.inner) };
        inner.poll_next(cx)
    }
}
