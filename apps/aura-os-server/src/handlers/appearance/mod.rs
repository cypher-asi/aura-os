//! Project appearance handlers.
//!
//! Persists per-project visual customization (accent color, icon,
//! background style, banner image, background image) as plain files
//! under the project's workspace folder. The on-disk layout is mirrored
//! by the module layout here:
//!
//! - [`paths`]            — `.aura/` directory resolution + small constants.
//! - [`metadata`]         — JSON file read/write (`appearance.json`).
//! - [`image_asset`]      — shared PUT/GET/DELETE for image asset files,
//!                          with magic-byte validation and atomic writes.
//! - [`banner`]            — banner-specific endpoints wrapping the
//!                          shared image-asset helpers.
//! - [`background_image`] — background-image endpoints, same pattern.
//!
//! Files live under:
//!
//! ```text
//! <project workspace>/.aura/
//!   appearance.json         (metadata)
//!   banner.{png,jpg}        (banner image)
//!   background.{png,jpg}    (background image)
//! ```
//!
//! Workspace resolves to the project's `local_workspace_path` when
//! set (so `.aura/` can be committed to the user's repo), falling
//! back to `<data_dir>/workspaces/<project_id>/` — the same canonical
//! path used by artifact thumbnails.

mod background_image;
mod banner;
mod image_asset;
mod metadata;
mod paths;

pub(crate) use background_image::{
    delete_background_image, get_background_image, put_background_image,
};
pub(crate) use banner::{delete_banner, get_banner, put_banner};
pub(crate) use image_asset::IMAGE_ASSET_MAX_BYTES;
pub(crate) use metadata::{get_appearance, put_appearance};
