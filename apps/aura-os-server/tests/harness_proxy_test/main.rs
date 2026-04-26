#[path = "../common/mod.rs"]
#[allow(dead_code)]
mod common;

use std::sync::LazyLock;

pub(crate) static HARNESS_URL_ENV_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

mod errors;
mod mocks;
mod proxy_forwards;
mod skills_create;
mod skills_delete;
mod skills_list;
