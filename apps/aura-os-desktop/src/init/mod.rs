//! Process-startup concerns: CLI parsing, env defaults, logging,
//! filesystem layout, the JS boot script, and crash handlers.

pub(crate) mod cli;
pub(crate) mod crash;
pub(crate) mod env;
pub(crate) mod init_script;
pub(crate) mod logging;
pub(crate) mod paths;
