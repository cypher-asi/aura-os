"""Unit tests for the AuraAgent shim.

These tests must pass with `python3 -m unittest` even when terminal-bench is
not installed. We do that by injecting lightweight stub modules into
``sys.modules`` *before* importing the agent module.
"""

from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


# --- TB stubs ---------------------------------------------------------------
# Inject minimal stand-ins for the terminal_bench imports the shim performs
# at import time. We keep the AgentResult constructor permissive so we can
# inspect what the shim passed to it.


class _StubAgentResult:
    """Minimal AgentResult stand-in that records constructor kwargs."""

    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def __repr__(self):  # pragma: no cover - debug aid
        return f"_StubAgentResult({self.kwargs!r})"


class _StubBaseAgent:
    def __init__(self, *_args, **_kwargs):
        pass


class _StubTerminalSession:  # pragma: no cover - placeholder
    pass


def _install_terminal_bench_stubs() -> None:
    if "terminal_bench" in sys.modules:
        return

    pkg = types.ModuleType("terminal_bench")
    pkg.__path__ = []  # mark as a package

    agents_pkg = types.ModuleType("terminal_bench.agents")
    agents_pkg.__path__ = []

    base_agent_mod = types.ModuleType("terminal_bench.agents.base_agent")
    base_agent_mod.BaseAgent = _StubBaseAgent

    types_mod = types.ModuleType("terminal_bench.agents.types")
    types_mod.AgentResult = _StubAgentResult

    terminal_pkg = types.ModuleType("terminal_bench.terminal")
    terminal_pkg.__path__ = []

    session_mod = types.ModuleType("terminal_bench.terminal.session")
    session_mod.TerminalSession = _StubTerminalSession

    sys.modules["terminal_bench"] = pkg
    sys.modules["terminal_bench.agents"] = agents_pkg
    sys.modules["terminal_bench.agents.base_agent"] = base_agent_mod
    sys.modules["terminal_bench.agents.types"] = types_mod
    sys.modules["terminal_bench.terminal"] = terminal_pkg
    sys.modules["terminal_bench.terminal.session"] = session_mod


_install_terminal_bench_stubs()

# Make sure aura_agent is importable when this file is loaded directly via
# `python3 -m unittest path/to/file.py`.
_HERE = Path(__file__).resolve().parent
_PARENT = _HERE.parent
for candidate in (_HERE, _PARENT):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

aura_agent = importlib.import_module("aura_agent.aura_agent")


class _FakeSession:
    """A drop-in TB session stub exposing a known workspace path."""

    def __init__(self, workspace_path: str, task_id: str = "tb-task-001"):
        self.task = types.SimpleNamespace(
            workspace_path=workspace_path, task_id=task_id
        )


class AuraAgentInitTests(unittest.TestCase):
    def setUp(self):
        self._env_backup = os.environ.copy()
        # Clear the env we care about so each test sets exactly what it needs.
        for key in (
            "AURA_EVAL_ACCESS_TOKEN",
            "AURA_EVAL_API_BASE_URL",
            "AURA_EVAL_STORAGE_URL",
            "AURA_BENCH_LOOP_TIMEOUT_SECONDS",
            "AURA_BENCH_BRIDGE_NODE",
            "AURA_BENCH_REPO_ROOT",
            "AURA_BENCH_TBENCH_RESULTS_DIR",
            "AURA_BENCH_RUN_ID",
            "AURA_BENCH_LOAD_ENV",
        ):
            os.environ.pop(key, None)
        os.environ["AURA_BENCH_LOAD_ENV"] = "0"
        self._results_tmpdir = tempfile.mkdtemp(prefix="aura-tbench-test-results-")

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env_backup)
        shutil.rmtree(self._results_tmpdir, ignore_errors=True)

    def test_missing_access_token_raises(self):
        os.environ["AURA_BENCH_REPO_ROOT"] = str(_PARENT.parent.parent.parent.parent)
        os.environ["AURA_BENCH_TBENCH_RESULTS_DIR"] = self._results_tmpdir
        with self.assertRaises(RuntimeError) as ctx:
            aura_agent.AuraAgent()
        self.assertIn("AURA_EVAL_ACCESS_TOKEN", str(ctx.exception))

    def test_init_succeeds_with_minimal_env(self):
        repo_root = _PARENT.parent.parent.parent.parent
        os.environ["AURA_EVAL_ACCESS_TOKEN"] = "fake-token"
        os.environ["AURA_BENCH_REPO_ROOT"] = str(repo_root)
        os.environ["AURA_BENCH_TBENCH_RESULTS_DIR"] = self._results_tmpdir
        agent = aura_agent.AuraAgent()
        self.assertEqual(agent._config.access_token, "fake-token")
        self.assertEqual(
            agent._config.api_base_url, "http://127.0.0.1:3190"
        )
        self.assertTrue(agent._config.bridge_script.is_file())
        self.assertEqual(str(agent._config.results_dir), self._results_tmpdir)


class BridgeCommandTests(unittest.TestCase):
    def test_argv_uses_configured_node_and_bridge_path(self):
        bridge_path = Path("/tmp/repo/infra/evals/external/tbench/bin/run-aura-pipeline.mjs")
        payload_path = Path("/tmp/payload.json")
        config = aura_agent._AuraAgentConfig(
            api_base_url="http://127.0.0.1:3190",
            access_token="tkn",
            storage_url="",
            loop_timeout_seconds=42,
            node_bin="/usr/local/bin/node-stub",
            repo_root=Path("/tmp/repo"),
            results_dir=Path("/tmp/repo/results"),
            bridge_script=bridge_path,
        )
        argv = aura_agent._build_bridge_argv(config, payload_path)
        self.assertEqual(
            argv,
            [
                "/usr/local/bin/node-stub",
                str(bridge_path),
                str(payload_path),
            ],
        )

    def test_perform_task_invokes_bridge_with_expected_argv(self):
        repo_root = _PARENT.parent.parent.parent.parent
        results_tmpdir = tempfile.mkdtemp(prefix="aura-tbench-test-results-")
        self.addCleanup(shutil.rmtree, results_tmpdir, ignore_errors=True)
        env = {
            "AURA_EVAL_ACCESS_TOKEN": "fake-token",
            "AURA_BENCH_REPO_ROOT": str(repo_root),
            "AURA_BENCH_BRIDGE_NODE": "node-stub",
            "AURA_BENCH_TBENCH_RESULTS_DIR": results_tmpdir,
        }
        bridge_stdout = (
            json.dumps(
                {
                    "ok": True,
                    "runId": "tbench-tb-task-001-9999",
                    "status": "agent_complete",
                    "costUsd": 0.42,
                    "totalTokens": 12345,
                    "fileChangeCount": 7,
                }
            )
            + "\n"
        )
        with mock.patch.dict(os.environ, env, clear=False):
            with mock.patch.object(
                subprocess, "run"
            ) as run_mock, mock.patch.object(
                aura_agent, "_resolve_host_workspace_path"
            ) as resolve_mock:
                resolve_mock.return_value = "/host/path/to/workspace"
                run_mock.return_value = subprocess.CompletedProcess(
                    args=[],
                    returncode=0,
                    stdout=bridge_stdout,
                    stderr="",
                )
                agent = aura_agent.AuraAgent()
                # Use a small timeout so the bridge_timeout assertion is stable.
                agent._config = aura_agent._AuraAgentConfig(
                    api_base_url=agent._config.api_base_url,
                    access_token=agent._config.access_token,
                    storage_url=agent._config.storage_url,
                    loop_timeout_seconds=10,
                    node_bin=agent._config.node_bin,
                    repo_root=agent._config.repo_root,
                    results_dir=agent._config.results_dir,
                    bridge_script=agent._config.bridge_script,
                )
                session = _FakeSession("/host/path/to/workspace", task_id="tb-task-001")
                result = agent.perform_task("Make the test pass.", session)

        self.assertEqual(run_mock.call_count, 1)
        argv = run_mock.call_args.args[0]
        self.assertEqual(argv[0], "node-stub")
        self.assertTrue(argv[1].endswith("run-aura-pipeline.mjs"))
        # The third arg is a temp payload file path.
        self.assertTrue(argv[2].endswith(".json"))
        # Bridge timeout = loop_timeout_seconds + 60 buffer.
        self.assertEqual(run_mock.call_args.kwargs["timeout"], 70)

        self.assertIsInstance(result, _StubAgentResult)
        self.assertTrue(result.kwargs["success"])
        self.assertEqual(result.kwargs["metadata"]["task_id"], "tb-task-001")
        self.assertEqual(
            result.kwargs["metadata"]["aura_run_id"], "tbench-tb-task-001-9999"
        )


class BridgeStdoutParserTests(unittest.TestCase):
    def test_parses_success_line(self):
        raw = (
            '[aura-tbench] {"step":"bridge_start"}\n'
            '{"ok": true, "runId": "abc", "status": "agent_complete", '
            '"costUsd": 0.5, "totalTokens": 100, "fileChangeCount": 2}\n'
        )
        parsed = aura_agent._parse_bridge_stdout(raw)
        self.assertTrue(parsed["ok"])
        self.assertEqual(parsed["runId"], "abc")
        self.assertEqual(parsed["totalTokens"], 100)

    def test_parses_error_line(self):
        raw = '{"ok": false, "runId": null, "status": "agent_error", "error": "boom"}\n'
        parsed = aura_agent._parse_bridge_stdout(raw)
        self.assertFalse(parsed["ok"])
        self.assertEqual(parsed["error"], "boom")

    def test_picks_last_json_line_when_multiple_emitted(self):
        raw = (
            '{"ok": false, "error": "early"}\n'
            'plain text noise\n'
            '{"ok": true, "runId": "later"}\n'
        )
        parsed = aura_agent._parse_bridge_stdout(raw)
        self.assertTrue(parsed["ok"])
        self.assertEqual(parsed["runId"], "later")

    def test_raises_on_empty_stdout(self):
        with self.assertRaises(ValueError):
            aura_agent._parse_bridge_stdout("")
        with self.assertRaises(ValueError):
            aura_agent._parse_bridge_stdout("   \n\n  ")

    def test_raises_when_no_json_line_present(self):
        with self.assertRaises(ValueError):
            aura_agent._parse_bridge_stdout("only text, no json\nnothing parseable\n")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
