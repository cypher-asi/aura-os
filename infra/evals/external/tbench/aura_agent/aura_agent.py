"""
Terminal-Bench agent that delegates to a running AURA backend.

For each TB task:
1. Confirm an aura-os-server is reachable at AURA_EVAL_API_BASE_URL with
   AURA_EVAL_ACCESS_TOKEN set in the environment.
2. Walk the TB container's working directory (/app) into a base64 file list
   indirectly via the Node bridge, which receives a host path.
3. Build a SWE-bench-style scenario object inside the Node bridge.
4. Invoke a tiny Node bridge (infra/evals/external/tbench/bin/run-aura-pipeline.mjs)
   to call runScenario from benchmark-api-runner.mjs.
5. Wait for the pipeline to finish.
6. Return AgentResult to TB; TB then runs the hidden verifier.

This shim does not interact with the tmux session directly — AURA's autonomous
loop runs against the imported workspace, not against the live tmux pane. After
the loop finishes, TB will run its hidden verifier against the same /app
filesystem (which AURA's harness has been writing to via mounted workspace
bind-mounts).

============================================================
TB import paths and APIs this shim depends on
============================================================
If Terminal-Bench changes any of the following, fix them in this single file:

- ``terminal_bench.agents.base_agent.BaseAgent`` — parent class.
- ``terminal_bench.agents.types.AgentResult`` — return value of perform_task.
  This shim assumes AgentResult has at least: ``success: bool``,
  ``failure_mode: str | None``, and accepts ``metadata: dict``.
- ``terminal_bench.terminal.session.TerminalSession`` — passed into
  perform_task. The shim probes for several optional attributes (any of
  ``task.workspace_path``, ``workspace_path``, ``host_workspace_path``,
  ``task_paths.workspace_path``) to find the host filesystem path that
  corresponds to the container's /app directory. If TB exposes this under a
  different attribute name in a future version, extend
  :func:`_resolve_host_workspace_path` below.

If TB cannot tell us the host path at all, the shim falls back to streaming a
tar of /app over ``session.send_keys`` + ``capture_pane`` and decoding it on
the host. This is best-effort and slow; it exists so the shim does not
silently fail when run against a TB version we do not understand.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from terminal_bench.agents.base_agent import BaseAgent
    from terminal_bench.agents.types import AgentResult
    from terminal_bench.terminal.session import TerminalSession  # type: ignore
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "terminal-bench is not installed. Install it with `pip install terminal-bench`."
    ) from exc


_LOGGER = logging.getLogger("aura_agent")

_DEFAULT_API_BASE_URL = "http://127.0.0.1:3190"
_DEFAULT_LOOP_TIMEOUT_SECONDS = 1500
_DEFAULT_NODE_BIN = "node"
_BRIDGE_BUFFER_SECONDS = 60


def _parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[len("export ") :].strip()
    if "=" not in stripped:
        return None
    key, value = stripped.split("=", 1)
    key = key.strip()
    if not key or not (key[0].isalpha() or key[0] == "_"):
        return None
    if not all(ch.isalnum() or ch == "_" for ch in key):
        return None
    value = value.strip()
    if (
        len(value) >= 2
        and ((value[0] == value[-1] == '"') or (value[0] == value[-1] == "'"))
    ):
        value = value[1:-1]
    return key, value


def _load_env_file(path: Path) -> bool:
    if not path.is_file():
        return False
    for line in path.read_text(encoding="utf-8").splitlines():
        parsed = _parse_env_line(line)
        if parsed is None:
            continue
        key, value = parsed
        os.environ.setdefault(key, value)
    return True


def _load_external_benchmark_env(repo_root: Path) -> list[Path]:
    if os.environ.get("AURA_BENCH_LOAD_ENV") == "0":
        return []

    local_stack_dir = repo_root / "infra" / "evals" / "local-stack"
    runtime_dir = Path(
        os.environ.get("AURA_STACK_RUNTIME_DIR", str(local_stack_dir / ".runtime"))
    )
    candidates = [
        repo_root / ".env",
        repo_root / ".env.local",
        local_stack_dir / "stack.env",
        runtime_dir / "evals.env",
        runtime_dir / "auth.env",
    ]
    loaded = [path for path in candidates if _load_env_file(path)]

    if not os.environ.get("AURA_EVAL_ACCESS_TOKEN"):
        for alias in ("AURA_ACCESS_TOKEN", "AURA_NETWORK_AUTH_TOKEN"):
            alias_value = os.environ.get(alias, "").strip()
            if alias_value:
                os.environ["AURA_EVAL_ACCESS_TOKEN"] = alias_value
                break

    if not os.environ.get("AURA_EVAL_ACCESS_TOKEN") and os.environ.get(
        "AURA_STACK_AURA_OS_DATA_DIR"
    ):
        try:
            completed = subprocess.run(
                [
                    "cargo",
                    "run",
                    "-q",
                    "-p",
                    "aura-os-server",
                    "--bin",
                    "print-auth-token",
                    "--",
                    os.environ["AURA_STACK_AURA_OS_DATA_DIR"],
                ],
                cwd=repo_root,
                capture_output=True,
                text=True,
                check=True,
            )
            token = completed.stdout.strip()
            if token:
                os.environ["AURA_EVAL_ACCESS_TOKEN"] = token
        except (FileNotFoundError, subprocess.CalledProcessError):
            pass

    if not os.environ.get("ANTHROPIC_API_KEY") and os.environ.get(
        "AURA_STACK_ANTHROPIC_API_KEY"
    ):
        os.environ["ANTHROPIC_API_KEY"] = os.environ["AURA_STACK_ANTHROPIC_API_KEY"]

    if not os.environ.get("AURA_EVAL_API_BASE_URL") and os.environ.get(
        "AURA_STACK_AURA_OS_PORT"
    ):
        os.environ["AURA_EVAL_API_BASE_URL"] = (
            f"http://127.0.0.1:{os.environ['AURA_STACK_AURA_OS_PORT']}"
        )

    return loaded


@dataclass(frozen=True)
class _AuraAgentConfig:
    """Resolved configuration for a single AuraAgent instance."""

    api_base_url: str
    access_token: str
    storage_url: str
    loop_timeout_seconds: int
    node_bin: str
    repo_root: Path
    results_dir: Path
    bridge_script: Path

    @property
    def loop_timeout_ms(self) -> int:
        return int(self.loop_timeout_seconds * 1000)


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(
            f"AuraAgent: environment variable {name} is required but is empty."
        )
    return value


def _resolve_repo_root(explicit: str | None) -> Path:
    if explicit:
        candidate = Path(explicit).expanduser().resolve()
        if not candidate.is_dir():
            raise RuntimeError(
                f"AuraAgent: AURA_BENCH_REPO_ROOT={candidate} does not exist."
            )
        return candidate
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(
            "AuraAgent: AURA_BENCH_REPO_ROOT is unset and `git rev-parse "
            "--show-toplevel` failed. Either run inside a git checkout or set "
            "AURA_BENCH_REPO_ROOT to the AURA repo root."
        ) from exc
    return Path(completed.stdout.strip()).resolve()


def _resolve_results_dir(explicit: str | None, repo_root: Path) -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    run_id = os.environ.get("AURA_BENCH_RUN_ID", "").strip()
    if not run_id:
        run_id = f"adhoc-{int(time.time())}"
    return (
        repo_root
        / "infra"
        / "evals"
        / "reports"
        / "external"
        / "tbench_2_core"
        / run_id
        / "runs"
    )


def _build_config() -> _AuraAgentConfig:
    repo_root = _resolve_repo_root(os.environ.get("AURA_BENCH_REPO_ROOT"))
    _load_external_benchmark_env(repo_root)

    api_base_url = (
        os.environ.get("AURA_EVAL_API_BASE_URL", "").strip() or _DEFAULT_API_BASE_URL
    )
    access_token = _require_env("AURA_EVAL_ACCESS_TOKEN")
    storage_url = os.environ.get("AURA_EVAL_STORAGE_URL", "").strip()
    loop_timeout_seconds = int(
        os.environ.get(
            "AURA_BENCH_LOOP_TIMEOUT_SECONDS", str(_DEFAULT_LOOP_TIMEOUT_SECONDS)
        )
    )
    node_bin = (
        os.environ.get("AURA_BENCH_BRIDGE_NODE", "").strip() or _DEFAULT_NODE_BIN
    )
    results_dir = _resolve_results_dir(
        os.environ.get("AURA_BENCH_TBENCH_RESULTS_DIR"), repo_root
    )
    bridge_script = (
        repo_root
        / "infra"
        / "evals"
        / "external"
        / "tbench"
        / "bin"
        / "run-aura-pipeline.mjs"
    )
    return _AuraAgentConfig(
        api_base_url=api_base_url,
        access_token=access_token,
        storage_url=storage_url,
        loop_timeout_seconds=loop_timeout_seconds,
        node_bin=node_bin,
        repo_root=repo_root,
        results_dir=results_dir,
        bridge_script=bridge_script,
    )


def _resolve_host_workspace_path(session: Any) -> str | None:
    """Probe the TerminalSession for a host filesystem path corresponding to /app.

    TB's public API has shifted across versions. We try a small set of likely
    attribute paths and return the first one that resolves to an existing
    directory. Returning None means the caller should fall back to a tar
    capture or raise.
    """

    candidates: list[Any] = []

    task = getattr(session, "task", None)
    if task is not None:
        candidates.append(getattr(task, "workspace_path", None))
        candidates.append(getattr(task, "host_workspace_path", None))
        task_paths = getattr(task, "task_paths", None)
        if task_paths is not None:
            candidates.append(getattr(task_paths, "workspace_path", None))
            candidates.append(getattr(task_paths, "host_workspace_path", None))

    candidates.append(getattr(session, "workspace_path", None))
    candidates.append(getattr(session, "host_workspace_path", None))
    task_paths = getattr(session, "task_paths", None)
    if task_paths is not None:
        candidates.append(getattr(task_paths, "workspace_path", None))
        candidates.append(getattr(task_paths, "host_workspace_path", None))

    for candidate in candidates:
        if candidate is None:
            continue
        try:
            path = Path(str(candidate)).expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        if path.is_dir():
            return str(path)

    return None


def _resolve_task_id(session: Any) -> str:
    task = getattr(session, "task", None)
    if task is not None:
        for attr in ("task_id", "id", "name"):
            value = getattr(task, attr, None)
            if isinstance(value, str) and value.strip():
                return value.strip()
    for attr in ("task_id", "id", "name"):
        value = getattr(session, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return uuid.uuid4().hex[:12]


def _capture_workspace_via_tar(
    session: Any, dest_dir: Path, container_dir: str = "/app"
) -> str | None:
    """Best-effort fallback: ask the container to dump /app via tar+base64.

    Returns the resolved host path (== ``dest_dir``) on success, or None if we
    could not extract the workspace. This relies on ``session.send_keys`` and
    ``session.capture_pane`` existing on the TB session object — both have
    been part of TB's public surface since at least 2024.
    """

    send_keys = getattr(session, "send_keys", None)
    capture_pane = getattr(session, "capture_pane", None)
    if not callable(send_keys) or not callable(capture_pane):
        return None

    sentinel = f"AURA_TAR_BEGIN_{uuid.uuid4().hex[:8]}"
    end_sentinel = f"AURA_TAR_END_{uuid.uuid4().hex[:8]}"
    cmd = (
        f"echo {sentinel}; "
        f"tar -C {container_dir} -cf - . 2>/dev/null | base64 -w0; "
        f"echo; echo {end_sentinel}"
    )

    try:
        send_keys(f"{cmd}\n")
    except Exception as exc:  # pragma: no cover - defensive
        _LOGGER.warning("send_keys failed during tar fallback: %s", exc)
        return None

    deadline = time.time() + 300
    captured = ""
    while time.time() < deadline:
        try:
            captured = capture_pane()
        except Exception as exc:  # pragma: no cover - defensive
            _LOGGER.warning("capture_pane failed during tar fallback: %s", exc)
            return None
        if isinstance(captured, str) and end_sentinel in captured and sentinel in captured:
            break
        time.sleep(2)
    else:
        _LOGGER.warning("Timed out waiting for tar fallback to complete in pane.")
        return None

    try:
        body = captured.split(sentinel, 1)[1].split(end_sentinel, 1)[0]
    except (IndexError, AttributeError):
        return None

    body = "".join(body.split())
    if not body:
        return None

    try:
        archive = base64.b64decode(body, validate=False)
    except (ValueError, TypeError):
        return None

    dest_dir.mkdir(parents=True, exist_ok=True)
    archive_path = dest_dir / "_aura_workspace.tar"
    archive_path.write_bytes(archive)
    try:
        subprocess.run(
            ["tar", "-xf", str(archive_path), "-C", str(dest_dir)],
            check=True,
            capture_output=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        _LOGGER.warning("Failed to extract fallback tar archive: %s", exc)
        return None
    finally:
        try:
            archive_path.unlink()
        except OSError:
            pass
    return str(dest_dir)


def _parse_bridge_stdout(raw_stdout: str) -> dict[str, Any]:
    """Parse the single JSON status line emitted by the Node bridge.

    The bridge prints exactly one JSON object on stdout. Streamed progress
    goes to stderr, so we only consider the *last* non-blank line of stdout
    as the canonical status. Falling back to scanning all lines lets us
    tolerate accidental extra output.
    """

    if not raw_stdout:
        raise ValueError("Bridge produced no stdout.")
    lines = [line.strip() for line in raw_stdout.splitlines() if line.strip()]
    if not lines:
        raise ValueError("Bridge produced only whitespace on stdout.")
    for line in reversed(lines):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise ValueError(
        f"Bridge stdout did not contain a JSON object. Tail: {lines[-1][:200]!r}"
    )


def _build_bridge_argv(
    config: _AuraAgentConfig, payload_path: Path
) -> list[str]:
    return [
        config.node_bin,
        str(config.bridge_script),
        str(payload_path),
    ]


class AuraAgent(BaseAgent):
    """Terminal-Bench agent that hands the actual work to a running AURA backend."""

    def __init__(self, **kwargs: Any) -> None:
        try:
            super().__init__(**kwargs)
        except TypeError:
            super().__init__()
        self._config = _build_config()
        self._config.results_dir.mkdir(parents=True, exist_ok=True)
        if not self._config.bridge_script.is_file():
            raise RuntimeError(
                "AuraAgent: bridge script not found at "
                f"{self._config.bridge_script}. Did the tbench tree get moved?"
            )

    @staticmethod
    def name() -> str:
        return "aura-tbench"

    def perform_task(
        self, task_description: str, session: Any
    ) -> Any:
        config = self._config
        task_id = _resolve_task_id(session)
        started_at = time.time()

        workspace_dir = _resolve_host_workspace_path(session)
        scratch_dir: Path | None = None
        if workspace_dir is None:
            scratch_dir = Path(
                tempfile.mkdtemp(prefix=f"aura-tbench-{task_id}-")
            )
            workspace_dir = _capture_workspace_via_tar(session, scratch_dir)
        if workspace_dir is None:
            if scratch_dir is not None:
                shutil.rmtree(scratch_dir, ignore_errors=True)
            return self._build_failure_result(
                task_id,
                started_at,
                failure_mode="workspace_unavailable",
                message=(
                    "AuraAgent could not determine a host filesystem path for "
                    "the TB task workspace. Inspect _resolve_host_workspace_path "
                    "in aura_agent.py and add the attribute exposed by your TB "
                    "version."
                ),
            )

        payload = {
            "task_id": task_id,
            "task_description": task_description,
            "workspace_dir": workspace_dir,
            "loop_timeout_ms": config.loop_timeout_ms,
            "aura_api_base_url": config.api_base_url,
            "aura_access_token": config.access_token,
            "aura_storage_url": config.storage_url,
        }

        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".json",
            prefix=f"aura-tbench-{task_id}-",
            delete=False,
            encoding="utf-8",
        ) as payload_file:
            json.dump(payload, payload_file)
            payload_path = Path(payload_file.name)

        argv = _build_bridge_argv(config, payload_path)
        bridge_timeout = config.loop_timeout_seconds + _BRIDGE_BUFFER_SECONDS

        bridge_stdout = ""
        bridge_stderr = ""
        bridge_exit_code: int | None = None
        timed_out = False
        run_error: str | None = None

        try:
            completed = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=bridge_timeout,
                check=False,
            )
            bridge_stdout = completed.stdout or ""
            bridge_stderr = completed.stderr or ""
            bridge_exit_code = completed.returncode
        except subprocess.TimeoutExpired as exc:
            timed_out = True
            bridge_stdout = (exc.stdout or b"").decode("utf-8", errors="replace") if isinstance(exc.stdout, (bytes, bytearray)) else (exc.stdout or "")
            bridge_stderr = (exc.stderr or b"").decode("utf-8", errors="replace") if isinstance(exc.stderr, (bytes, bytearray)) else (exc.stderr or "")
            run_error = (
                f"AURA pipeline exceeded bridge timeout of {bridge_timeout}s."
            )
        except FileNotFoundError as exc:
            run_error = f"Failed to launch Node bridge: {exc}"
        finally:
            try:
                payload_path.unlink()
            except OSError:
                pass

        wallclock = time.time() - started_at

        parsed: dict[str, Any] = {}
        parse_error: str | None = None
        if not timed_out and run_error is None:
            try:
                parsed = _parse_bridge_stdout(bridge_stdout)
            except ValueError as exc:
                parse_error = str(exc)

        ok = bool(parsed.get("ok")) and not timed_out and run_error is None
        status = (
            "agent_timeout"
            if timed_out
            else ("agent_complete" if ok else "agent_error")
        )
        message_parts: list[str] = []
        if run_error:
            message_parts.append(run_error)
        if parse_error:
            message_parts.append(f"Bridge stdout parse error: {parse_error}")
        if not ok and parsed.get("error"):
            message_parts.append(str(parsed["error"]))
        if not message_parts:
            message_parts.append(
                "AURA pipeline finished. TB will now run the hidden verifier."
            )

        result_record: dict[str, Any] = {
            "task_id": task_id,
            "status": status,
            "ok": ok,
            "wallclock_seconds": wallclock,
            "bridge": {
                "argv": argv,
                "exit_code": bridge_exit_code,
                "timed_out": timed_out,
                "stdout": bridge_stdout,
                "stderr_tail": bridge_stderr[-4000:] if bridge_stderr else "",
            },
            "bridge_payload": payload,
            "bridge_result": parsed,
        }
        self._persist_result(task_id, result_record)

        if scratch_dir is not None and ok:
            shutil.rmtree(scratch_dir, ignore_errors=True)

        return self._build_agent_result(
            success=ok,
            failure_mode=None if ok else status,
            message="; ".join(message_parts),
            metadata={
                "task_id": task_id,
                "aura_run_id": parsed.get("runId"),
                "cost_usd": parsed.get("costUsd"),
                "total_tokens": parsed.get("totalTokens"),
                "file_change_count": parsed.get("fileChangeCount"),
                "wallclock_seconds": wallclock,
            },
        )

    def _persist_result(self, task_id: str, record: dict[str, Any]) -> None:
        out_path = self._config.results_dir / f"{task_id}.json"
        try:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(record, indent=2), encoding="utf-8")
        except OSError as exc:
            _LOGGER.warning("Failed to persist AURA TB result for %s: %s", task_id, exc)

    def _build_failure_result(
        self,
        task_id: str,
        started_at: float,
        *,
        failure_mode: str,
        message: str,
    ) -> Any:
        record = {
            "task_id": task_id,
            "status": failure_mode,
            "ok": False,
            "wallclock_seconds": time.time() - started_at,
            "bridge": None,
            "bridge_payload": None,
            "bridge_result": {"error": message},
        }
        self._persist_result(task_id, record)
        return self._build_agent_result(
            success=False,
            failure_mode=failure_mode,
            message=message,
            metadata={"task_id": task_id},
        )

    @staticmethod
    def _build_agent_result(
        *,
        success: bool,
        failure_mode: str | None,
        message: str,
        metadata: dict[str, Any],
    ) -> Any:
        """Construct AgentResult tolerantly across TB versions.

        Different TB releases have shipped different ``AgentResult`` shapes
        (some keyword-only, some dataclass-only). Try the richest form first
        and fall back progressively, surfacing a clear error if no shape
        matches.
        """

        attempts: list[tuple[str, dict[str, Any]]] = [
            (
                "success+failure_mode+message+metadata",
                {
                    "success": success,
                    "failure_mode": failure_mode,
                    "message": message,
                    "metadata": metadata,
                },
            ),
            (
                "success+failure_mode+metadata",
                {
                    "success": success,
                    "failure_mode": failure_mode,
                    "metadata": metadata,
                },
            ),
            (
                "success+failure_mode",
                {"success": success, "failure_mode": failure_mode},
            ),
            (
                "success+metadata",
                {"success": success, "metadata": metadata},
            ),
            ("success-only", {"success": success}),
        ]

        last_error: Exception | None = None
        for _label, kwargs in attempts:
            try:
                return AgentResult(**kwargs)
            except TypeError as exc:
                last_error = exc
                continue

        raise RuntimeError(
            "AuraAgent: AgentResult constructor signature is not recognized. "
            "TB likely changed its public API; update _build_agent_result. "
            f"Last error: {last_error!r}"
        )
