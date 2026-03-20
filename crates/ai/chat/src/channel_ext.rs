use tokio::sync::mpsc;

/// Sends a value on an unbounded channel, logging a warning if the receiver has been dropped.
pub(crate) fn send_or_log<T>(tx: &mpsc::UnboundedSender<T>, val: T) {
    if tx.send(val).is_err() {
        tracing::warn!(
            event_type = std::any::type_name::<T>(),
            "channel send failed: receiver dropped"
        );
    }
}
