use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TerminalId(pub(crate) Uuid);

impl Default for TerminalId {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl std::fmt::Display for TerminalId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::str::FromStr for TerminalId {
    type Err = uuid::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Uuid::parse_str(s)?))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: TerminalId,
    pub shell: String,
    pub cols: u16,
    pub rows: u16,
    pub cwd: String,
    pub created_at: u64,
    /// Optional project this terminal belongs to. Used by passive
    /// consumers (e.g. dev-server URL discovery) that want to attribute
    /// terminal output to a specific project context. Stored as a
    /// stringified UUID so this crate doesn't need to depend on
    /// `aura-os-core`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

struct TerminalSession {
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    reader: Option<Box<dyn Read + Send>>,
    info: TerminalInfo,
}

pub struct TerminalManager {
    sessions: Mutex<HashMap<TerminalId, TerminalSession>>,
}

pub(crate) fn default_shell() -> String {
    #[cfg(windows)]
    {
        if which::which("powershell.exe").is_ok() {
            "powershell.exe".into()
        } else {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
        }
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

pub(crate) fn default_cwd() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".into())
}

#[cfg(windows)]
fn is_powershell_shell(shell: &str) -> bool {
    let file_name = std::path::Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(shell);

    file_name.eq_ignore_ascii_case("powershell.exe") || file_name.eq_ignore_ascii_case("pwsh.exe")
}

/// Args to pass to PowerShell on spawn.
///
/// Beyond `-NoLogo` (suppress the startup banner), the `-Command`
/// payload installs two compatibility fixes for running PowerShell
/// over a `portable_pty` ConPTY pipe into xterm.js:
///
/// **1. `Clear-Host` override.** Emits the standard VT reset
/// sequences directly:
///
///  * `ESC[H`  — cursor home
///  * `ESC[2J` — erase visible viewport
///  * `ESC[3J` — erase saved lines (xterm.js scrollback)
///
/// Windows PowerShell 5.1's built-in `Clear-Host` calls
/// `[Console]::Clear()`, which routes through Win32 console APIs.
/// Over ConPTY the translation is imperfect (the visible viewport
/// isn't always fully wiped) and never emits `ESC[3J`, so the
/// 100k-line xterm.js scrollback survives — leaving old output one
/// scroll-up away from a "cleared" screen.
///
/// **2. PSReadLine removal.** PSReadLine maintains its own model of
/// the buffer width, prompt position, and wrap state, then redraws the
/// current line with cursor-save / selective-erase / cursor-restore VT
/// sequences on every keystroke and history navigation. When that
/// model disagrees with what xterm.js actually rendered — which it
/// readily does whenever output has wrapped, the prompt spans more
/// than one row, or the terminal was resized after spawn — the
/// redraws land in the wrong place and stack fragments of previous
/// content on top of the current line. Removing the module forces
/// PowerShell back to its built-in console-host line editor: no
/// inline prediction, no greyed completion overlay, and a much
/// simpler single-line redraw model with no wrap tracking. Up/Down
/// history and basic editing still work; tab completion / Ctrl+R
/// search / syntax highlighting are the trade-off.
///
/// `Remove-Module` runs after the user's profile has loaded (profiles
/// are processed before `-Command`), so any PSReadLine setup the user
/// did is discarded along with the module.
///
/// `[char]27` is used instead of the `` `e `` escape literal because the
/// latter only exists in PowerShell 6+ and would be a syntax error on
/// Windows PowerShell 5.1.
#[cfg(windows)]
pub(crate) fn powershell_args() -> Vec<&'static str> {
    vec![
        "-NoLogo",
        "-NoExit",
        "-Command",
        "function global:Clear-Host { \
         [Console]::Out.Write([char]27 + '[H' + [char]27 + '[2J' + [char]27 + '[3J') }; \
         Remove-Module PSReadLine -Force -ErrorAction SilentlyContinue",
    ]
}

fn configure_shell_command(cmd: &mut CommandBuilder, shell: &str) {
    // These identify the pane that launched Aura, not the new PTY. Keeping
    // them makes multiplexer-aware commands target an unrelated terminal.
    for key in [
        "TMUX",
        "TMUX_PANE",
        "STY",
        "WINDOW",
        "ZELLIJ",
        "ZELLIJ_SESSION_NAME",
        "ZELLIJ_PANE_ID",
    ] {
        cmd.env_remove(key);
    }
    #[cfg(windows)]
    if is_powershell_shell(shell) {
        for arg in powershell_args() {
            cmd.arg(arg);
        }
    }
    #[cfg(not(windows))]
    let _ = (cmd, shell);
}

struct PtyComponents {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
}

fn open_pty_session(
    shell: &str,
    working_dir: &str,
    cols: u16,
    rows: u16,
) -> Result<PtyComponents, String> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(shell);
    configure_shell_command(&mut cmd, shell);
    cmd.cwd(working_dir);
    cmd.env("TERM", "xterm-256color");
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;
    Ok(PtyComponents {
        child,
        master: pair.master,
        reader,
        writer,
    })
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn spawn(&self, cols: u16, rows: u16, cwd: Option<String>) -> Result<TerminalInfo, String> {
        self.spawn_with_project(cols, rows, cwd, None)
    }

    /// Spawn a terminal tagged with an optional project id. Callers that
    /// want the terminal to participate in per-project discovery should
    /// prefer this over [`Self::spawn`].
    pub fn spawn_with_project(
        &self,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        project_id: Option<String>,
    ) -> Result<TerminalInfo, String> {
        let shell = default_shell();
        let working_dir = cwd.unwrap_or_else(default_cwd);
        let PtyComponents {
            child,
            master,
            reader,
            writer,
        } = open_pty_session(&shell, &working_dir, cols, rows)?;

        let id = TerminalId::new();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let terminal_info = TerminalInfo {
            id,
            shell: shell.clone(),
            cols,
            rows,
            cwd: working_dir,
            created_at: now,
            project_id,
        };
        let session = TerminalSession {
            _child: child,
            master,
            writer,
            reader: Some(reader),
            info: terminal_info.clone(),
        };

        self.sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?
            .insert(id, session);
        info!(%id, %shell, "Terminal session spawned");
        Ok(terminal_info)
    }

    pub fn kill(&self, id: TerminalId) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;

        if let Some(mut session) = sessions.remove(&id) {
            if let Err(e) = session._child.kill() {
                warn!(%id, "Failed to kill terminal child process: {e}");
            }
            drop(session.reader.take());
            drop(session.writer);
            drop(session.master);
            info!(%id, "Terminal session killed");
            Ok(())
        } else {
            Err(format!("Terminal {id} not found"))
        }
    }

    pub fn resize(&self, id: TerminalId, cols: u16, rows: u16) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;

        if let Some(session) = sessions.get_mut(&id) {
            let size = PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            };
            session
                .master
                .resize(size)
                .map_err(|e| format!("Failed to resize PTY: {e}"))?;
            session.info.cols = cols;
            session.info.rows = rows;
            Ok(())
        } else {
            Err(format!("Terminal {id} not found"))
        }
    }

    /// Look up the project id associated with a terminal, if any.
    pub fn project_id_of(&self, id: TerminalId) -> Option<String> {
        self.sessions.lock().ok().and_then(|s| {
            s.get(&id)
                .and_then(|session| session.info.project_id.clone())
        })
    }

    pub fn list(&self) -> Vec<TerminalInfo> {
        self.sessions
            .lock()
            .map(|s| s.values().map(|v| v.info.clone()).collect())
            .unwrap_or_default()
    }

    pub fn write_input(&self, id: TerminalId, data: &[u8]) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;

        if let Some(session) = sessions.get_mut(&id) {
            session
                .writer
                .write_all(data)
                .map_err(|e| format!("Failed to write to PTY: {e}"))?;
            session
                .writer
                .flush()
                .map_err(|e| format!("Failed to flush PTY writer: {e}"))?;
            Ok(())
        } else {
            Err(format!("Terminal {id} not found"))
        }
    }

    pub fn take_reader(&self, id: TerminalId) -> Result<Box<dyn Read + Send>, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;

        if let Some(session) = sessions.get_mut(&id) {
            session
                .reader
                .take()
                .ok_or_else(|| format!("Reader for terminal {id} already taken"))
        } else {
            Err(format!("Terminal {id} not found"))
        }
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_shell_returns_nonempty() {
        let shell = default_shell();
        assert!(!shell.is_empty(), "default_shell() must not be empty");
    }

    #[test]
    fn test_default_cwd_returns_nonempty() {
        let cwd = default_cwd();
        assert!(!cwd.is_empty(), "default_cwd() must not be empty");
    }

    #[test]
    fn terminal_shell_does_not_inherit_parent_multiplexer_identity() {
        let mut cmd = CommandBuilder::new("bash");
        for key in [
            "TMUX",
            "TMUX_PANE",
            "STY",
            "WINDOW",
            "ZELLIJ",
            "ZELLIJ_SESSION_NAME",
            "ZELLIJ_PANE_ID",
        ] {
            cmd.env(key, "parent-pane");
        }
        cmd.env("ZELLIJ_CONFIG_DIR", "/tmp/zellij-config");
        cmd.env("PATH", "/usr/bin:/bin");
        cmd.env("AURA_TERMINAL_TEST", "keep-me");

        configure_shell_command(&mut cmd, "bash");

        for key in [
            "TMUX",
            "TMUX_PANE",
            "STY",
            "WINDOW",
            "ZELLIJ",
            "ZELLIJ_SESSION_NAME",
            "ZELLIJ_PANE_ID",
        ] {
            assert!(cmd.get_env(key).is_none(), "inherited parent pane: {key}");
        }
        assert_eq!(
            cmd.get_env("ZELLIJ_CONFIG_DIR"),
            Some(std::ffi::OsStr::new("/tmp/zellij-config"))
        );
        assert_eq!(
            cmd.get_env("PATH"),
            Some(std::ffi::OsStr::new("/usr/bin:/bin"))
        );
        assert_eq!(
            cmd.get_env("AURA_TERMINAL_TEST"),
            Some(std::ffi::OsStr::new("keep-me"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn test_is_powershell_shell_detects_common_names() {
        assert!(is_powershell_shell("powershell.exe"));
        assert!(is_powershell_shell("pwsh.exe"));
        assert!(is_powershell_shell(
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
        ));
        assert!(!is_powershell_shell("cmd.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn test_powershell_args_install_clear_host_override() {
        let args = powershell_args();
        assert_eq!(args.first().copied(), Some("-NoLogo"));
        assert!(args.contains(&"-NoExit"), "argv missing -NoExit: {args:?}");
        let cmd_idx = args
            .iter()
            .position(|a| *a == "-Command")
            .expect("-Command flag missing");
        let init = args
            .get(cmd_idx + 1)
            .expect("-Command must be followed by a script");
        assert!(
            init.contains("Clear-Host"),
            "init script must override Clear-Host: {init}"
        );
        // Each VT sequence we rely on must be present, expressed via
        // `[char]27` (PS 5.1-compatible) rather than the `` `e `` literal
        // that only exists on PowerShell 6+.
        assert!(
            init.contains("[char]27"),
            "init script must use [char]27 for PS 5.1 compatibility: {init}"
        );
        for seq in ["[H", "[2J", "[3J"] {
            assert!(
                init.contains(seq),
                "init script missing VT sequence {seq}: {init}"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn test_powershell_args_remove_psreadline() {
        let args = powershell_args();
        let cmd_idx = args
            .iter()
            .position(|a| *a == "-Command")
            .expect("-Command flag missing");
        let init = args
            .get(cmd_idx + 1)
            .expect("-Command must be followed by a script");
        assert!(
            init.contains("Remove-Module PSReadLine -Force -ErrorAction SilentlyContinue"),
            "init must remove PSReadLine to avoid history-nav rendering artifacts: {init}"
        );
        // We deliberately do not Import-Module / configure it — the
        // whole point is that PowerShell falls back to its built-in
        // line editor.
        assert!(
            !init.contains("Set-PSReadLineOption"),
            "init must not configure PSReadLine after removing it: {init}"
        );
    }

    #[test]
    fn test_terminal_id_display() {
        let id = TerminalId::new();
        let id_str = format!("{id}");
        assert!(!id_str.is_empty());
        assert!(id_str.contains('-'), "UUID should contain dashes: {id_str}");
    }

    #[test]
    fn test_list_empty_on_new_manager() {
        let mgr = TerminalManager::new();
        assert!(mgr.list().is_empty());
    }
}
