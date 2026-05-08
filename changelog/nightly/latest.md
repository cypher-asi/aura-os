# Account switching and avatar persistence fixes

- Date: `2026-05-08`
- Channel: `nightly`
- Version: `0.1.0-nightly.485.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.485.1

A focused nightly that closes two long-standing profile bugs: leftover data leaking between accounts after logout, and avatars silently disappearing after save. Both land in the desktop interface and ship across Mac, Windows, and Linux builds.

## 3:32 AM — Logout cleanup and persistent profile avatars

Two profile-layer fixes resolve user data bleeding between accounts on logout and avatars failing to persist after editing.

- Logging out now resets the profile, feed, and billing stores so a second user signing into the same session no longer sees the previous account's data until restart. (`922a392`)
- Profile editor uploads cropped avatars to S3 via presigned URL instead of saving a data URL, so profile images now persist through the API; the Save button also reflects an in-progress 'Saving…' state while the upload completes. (`aa30419`)

## Highlights

- Logout now fully clears the previous user's profile, feed, and billing data
- Profile avatars upload to S3 and persist across sessions

