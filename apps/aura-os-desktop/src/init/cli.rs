//! Command-line argument parsing for the desktop binary.

use aura_os_core::Channel;

/// Parsed CLI arguments for the desktop binary.
///
/// We intentionally avoid `clap` here: the desktop process is also launched
/// by installers / updaters that may pass platform-specific argv we don't
/// control, so unknown args must be tolerated rather than rejected.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DesktopCliArgs {
    pub(crate) external_harness: bool,
}

pub(crate) fn parse_cli_args_from<I, S>(iter: I) -> DesktopCliArgs
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = DesktopCliArgs::default();
    for arg in iter {
        if arg.as_ref() == "--external-harness" {
            args.external_harness = true;
        }
    }
    args
}

pub(crate) fn parse_cli_args() -> DesktopCliArgs {
    parse_cli_args_from(std::env::args().skip(1))
}

/// Returns a single-line channel report for `--print-channel`.
///
/// The format is line-oriented and stable so CI (`scripts/ci/verify-desktop.mjs`)
/// can grep for `channel=Stable` after building with
/// `--no-default-features --features stable-channel` and fail loudly if the
/// produced binary actually identifies as Dev — the exact regression that
/// previously let the published installer ship a Dev-in-disguise build.
pub(crate) fn channel_report() -> String {
    let channel = Channel::current();
    let label = match channel {
        Channel::Stable => "Stable",
        Channel::Dev => "Dev",
    };
    format!(
        "channel={label} version={version} data_dir={data} skills_home={skills} window_title=\"{title}\" mutex={mutex} desktop_port={port} updater_enabled={updater}",
        version = crate::release_version::current_version(),
        data = channel.data_dir_name(),
        skills = channel.skills_home_name(),
        title = channel.window_title(),
        mutex = channel.single_instance_mutex(),
        port = channel.preferred_desktop_port(),
        updater = channel.updater_enabled(),
    )
}

/// If the caller passed `--print-channel`, print the channel report to
/// stdout and exit 0 before doing anything else (no logging, no data dir
/// creation, no single-instance mutex). This must run from `main()` before
/// any startup side-effects.
pub(crate) fn maybe_handle_print_channel() {
    if std::env::args().skip(1).any(|arg| arg == "--print-channel") {
        println!("{}", channel_report());
        std::process::exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::{channel_report, parse_cli_args_from};
    use aura_os_core::Channel;

    #[test]
    fn parse_cli_args_defaults_to_no_external_harness() {
        let args = parse_cli_args_from(Vec::<String>::new());
        assert!(!args.external_harness);
    }

    #[test]
    fn parse_cli_args_detects_external_harness_flag() {
        let args = parse_cli_args_from(["--external-harness"]);
        assert!(args.external_harness);
    }

    #[test]
    fn parse_cli_args_tolerates_unknown_flags() {
        let args = parse_cli_args_from(["--some-installer-arg", "--external-harness", "ignored"]);
        assert!(args.external_harness);
    }

    #[test]
    fn channel_report_starts_with_channel_kv() {
        let report = channel_report();
        let expected_prefix = match Channel::current() {
            Channel::Stable => "channel=Stable ",
            Channel::Dev => "channel=Dev ",
        };
        assert!(
            report.starts_with(expected_prefix),
            "channel report `{report}` should start with `{expected_prefix}` so CI can grep it"
        );
    }

    #[test]
    fn channel_report_round_trips_data_and_skills_dirs() {
        let report = channel_report();
        let channel = Channel::current();
        assert!(report.contains(&format!("data_dir={}", channel.data_dir_name())));
        assert!(report.contains(&format!("skills_home={}", channel.skills_home_name())));
    }
}
