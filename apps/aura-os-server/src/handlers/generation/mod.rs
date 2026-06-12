mod harness_stream;
mod image;
mod model3d;
mod persist;
mod router_proxy;
mod sse;
mod video;

pub(crate) use image::{generate_image_stream, generate_image_tool};
pub(crate) use model3d::{generate_3d_stream, generate_3d_tool};
pub(crate) use video::{generate_video_stream, generate_video_tool};

/// Shared with `crate::handlers::public::generation_common` so the
/// public-mode proxy uses the same heartbeat shape + cadence as the
/// auth'd image / video / 3D handlers. See
/// [`image::GENERATION_HEARTBEAT_INTERVAL`] for the rationale.
pub(crate) use image::{build_generation_progress_heartbeat_event, GENERATION_HEARTBEAT_INTERVAL};

#[cfg(test)]
use image::run_generate_image_to_completion;

#[cfg(test)]
mod tests;
