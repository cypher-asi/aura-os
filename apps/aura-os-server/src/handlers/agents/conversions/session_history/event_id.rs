//! Stable identity for reconstructed chat messages.
//!
//! `events_to_session_history` used to stamp every reconstructed
//! [`aura_os_core::SessionEvent`] with a fresh random UUID, which made
//! `event_id` useless as a pagination cursor: the id a client got in one
//! response could never match anything in the next request's
//! reconstruction. Deriving the id deterministically from the backing
//! storage-event row id makes cursors (and FE row keys) stable across
//! requests without changing the wire shape.

use aura_os_core::SessionEventId;
use uuid::Uuid;

/// Derive a stable [`SessionEventId`] from a storage `session_events`
/// row id. Real aura-storage ids are UUIDs and pass through unchanged;
/// anything else (test fixtures, hypothetical future id schemes) is
/// folded through a deterministic 128-bit FNV-1a hash so the result is
/// still stable and collision-resistant for practical id counts.
pub(super) fn stable_event_id(storage_event_id: &str) -> SessionEventId {
    match storage_event_id.parse::<Uuid>() {
        Ok(parsed) => SessionEventId::from_uuid(parsed),
        Err(_) => {
            SessionEventId::from_uuid(Uuid::from_u128(fnv1a_128(storage_event_id.as_bytes())))
        }
    }
}

const FNV_OFFSET_BASIS_128: u128 = 0x6c62272e07bb014262b821756295c58d;
const FNV_PRIME_128: u128 = 0x0000000001000000000000000000013b;

fn fnv1a_128(bytes: &[u8]) -> u128 {
    let mut hash = FNV_OFFSET_BASIS_128;
    for byte in bytes {
        hash ^= u128::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME_128);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_storage_ids_pass_through() {
        let id = "11111111-2222-3333-4444-555555555555";
        assert_eq!(stable_event_id(id).to_string(), id);
    }

    #[test]
    fn non_uuid_storage_ids_hash_deterministically() {
        let first = stable_event_id("evt-1");
        let again = stable_event_id("evt-1");
        let other = stable_event_id("evt-2");
        assert_eq!(first, again, "same input must derive the same id");
        assert_ne!(first, other, "distinct inputs must derive distinct ids");
    }
}
