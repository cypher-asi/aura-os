//! Notes app handlers.
//!
//! Notes are plain markdown files stored on disk under
//! `<AURA_DATA_DIR>/notes/<project_id>/...` with real directories for folders.
//! No database — the folder tree is the filesystem, and per-note metadata
//! (creation timestamp, author) is YAML frontmatter inside the `.md`. Comments
//! live alongside each note as `<note>.comments.json`.
//!
//! The file-on-disk layout is mirrored by the module layout here:
//!
//! - [`paths`]       — path-safety, slugifying, and time helpers.
//! - [`root`]        — project ↔ notes-folder binding and migrations.
//! - [`frontmatter`] — YAML frontmatter parsing/rendering and title probes.
//! - [`tree`]        — directory walking and the `GET /tree` handler.
//! - [`content`]     — read/write a single note plus title-driven rename.
//! - [`entries`]     — create/rename/delete folders and notes.
//! - [`comments`]    — `<note>.comments.json` sidecar handlers.
//!
//! Only the HTTP handlers that the router wires up are re-exported at this
//! level — every helper stays internal so submodules can refactor freely.

mod comments;
mod content;
mod entries;
mod frontmatter;
mod paths;
mod root;
mod tree;

pub(crate) use comments::{add_comment, delete_comment, list_comments};
pub(crate) use content::{read_note, write_note};
pub(crate) use entries::{create_entry, delete_entry, rename_entry};
pub(crate) use tree::list_tree;
