//! Unit tests for the chat handler module. Split into focused files
//! so each test module stays under the 500-line cap.

#[cfg(test)]
mod errors_tests;

#[cfg(test)]
mod discovery_tests;

#[cfg(test)]
mod compaction_tests;

#[cfg(test)]
mod project_state_tests;
