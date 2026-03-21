use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TerminalId(pub Uuid);

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

fn default_shell() -> String {
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

fn default_cwd() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".into())
}

fn open_pty_session(
    shell: &str,
    working_dir: &str,
    cols: u16,
    rows: u16,
) -> Result<(
    Box<dyn portable_pty::Child + Send + Sync>,
    Box<dyn MasterPty + Send>,
    Box<dyn Read + Send>,
    Box<dyn Write + Send>,
), String> {
    let pty_system = native_pty_system();
    let size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
    let pair = pty_system.openpty(size).map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(working_dir);
    cmd.env("TERM", "xterm-256color");
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("Failed to spawn shell: {e}"))?;
    let reader = pair.master.try_clone_reader().map_err(|e| format!("Failed to clone PTY reader: {e}"))?;
    let writer = pair.master.take_writer().map_err(|e| format!("Failed to take PTY writer: {e}"))?;
    Ok((child, pair.master, reader, writer))
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn spawn(
        &self,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
    ) -> Result<TerminalInfo, String> {
        let shell = default_shell();
        let working_dir = cwd.unwrap_or_else(default_cwd);
        let (child, master, reader, writer) = open_pty_session(&shell, &working_dir, cols, rows)?;

        let id = TerminalId::new();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let terminal_info = TerminalInfo { id, shell: shell.clone(), cols, rows, cwd: working_dir, created_at: now };
        let session = TerminalSession {
            _child: child, master, writer, reader: Some(reader), info: terminal_info.clone(),
        };

        self.sessions.lock().map_err(|e| format!("Lock poisoned: {e}"))?.insert(id, session);
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

    pub fn take_reader(
        &self,
        id: TerminalId,
    ) -> Result<Box<dyn Read + Send>, String> {
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
