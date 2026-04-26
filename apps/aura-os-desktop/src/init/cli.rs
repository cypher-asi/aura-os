//! Command-line argument parsing for the desktop binary.

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

#[cfg(test)]
mod tests {
    use super::parse_cli_args_from;

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
}
