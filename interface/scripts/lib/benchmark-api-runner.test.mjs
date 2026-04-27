import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createBenchmarkClient,
  runScenario,
  summarizeSessionUsage,
  walkFixtureDir,
} from "./benchmark-api-runner.mjs";

async function makeTempFixture(layout) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bench-runner-fixture-"));
  for (const [relativePath, contents] of Object.entries(layout)) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents);
  }
  return root;
}

test("walkFixtureDir skips .git, node_modules, and __pycache__ directories", async () => {
  const root = await makeTempFixture({
    "README.md": "hello",
    "src/index.js": "console.log('hi');",
    ".git/HEAD": "ref: refs/heads/main",
    ".git/refs/heads/main": "abc123",
    "node_modules/lodash/index.js": "module.exports = {};",
    "__pycache__/module.cpython-310.pyc": "binary",
    ".pytest_cache/v/cache/lastfailed": "{}",
    ".venv/pyvenv.cfg": "home = /usr/bin",
    "scripts/build.sh": "echo build",
    "build.pyc": "binary-bytecode",
  });

  try {
    const files = await walkFixtureDir(root);
    const paths = files.map((file) => file.relative_path.replaceAll("\\", "/")).sort();

    assert.deepEqual(paths, ["README.md", "scripts/build.sh", "src/index.js"]);
    for (const file of files) {
      assert.equal(typeof file.contents_base64, "string");
      assert.ok(file.contents_base64.length > 0, "expected non-empty base64 contents");
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("walkFixtureDir requires an absolute path", async () => {
  await assert.rejects(
    () => walkFixtureDir("relative/path"),
    /must be absolute/,
  );
});

test("walkFixtureDir accepts an absolute path outside the interface tree", async () => {
  const root = await makeTempFixture({
    "main.py": "print('hi')\n",
    "tests/test_main.py": "def test_ok():\n    assert True\n",
  });

  try {
    assert.ok(path.isAbsolute(root), "tmpdir should produce an absolute path");
    const files = await walkFixtureDir(root);
    const paths = files.map((file) => file.relative_path.replaceAll("\\", "/")).sort();
    assert.deepEqual(paths, ["main.py", "tests/test_main.py"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("summarizeSessionUsage returns a none-source summary for an empty events array", () => {
  const summary = summarizeSessionUsage([]);
  assert.equal(summary.source, "none");
  assert.equal(summary.turnCount, 0);
  assert.equal(summary.inputTokens, 0);
  assert.equal(summary.outputTokens, 0);
  assert.equal(summary.cacheCreationInputTokens, 0);
  assert.equal(summary.cacheReadInputTokens, 0);
  assert.equal(summary.promptInputFootprintTokens, 0);
  assert.equal(summary.maxEstimatedContextTokens, 0);
  assert.equal(summary.maxContextUtilization, 0);
  assert.equal(summary.fileChangeCount, 0);
  assert.deepEqual(summary.models, []);
  assert.deepEqual(summary.providers, []);
});

test("summarizeSessionUsage extracts tokens from a single assistant_message_end event", () => {
  const summary = summarizeSessionUsage([
    {
      event_type: "assistant_message_end",
      content: {
        usage: {
          input_tokens: 100,
          output_tokens: 25,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
          estimated_context_tokens: 1234,
          context_utilization: 0.42,
          model: "claude-sonnet-test",
          provider: "anthropic",
        },
        files_changed: ["src/a.ts", "src/b.ts"],
      },
    },
  ]);

  assert.equal(summary.source, "assistant_message_end");
  assert.equal(summary.turnCount, 1);
  assert.equal(summary.inputTokens, 100);
  assert.equal(summary.outputTokens, 25);
  assert.equal(summary.cacheCreationInputTokens, 10);
  assert.equal(summary.cacheReadInputTokens, 5);
  assert.equal(summary.promptInputFootprintTokens, 115);
  assert.equal(summary.maxEstimatedContextTokens, 1234);
  assert.equal(summary.maxContextUtilization, 0.42);
  assert.equal(summary.fileChangeCount, 2);
  assert.deepEqual(summary.models, ["claude-sonnet-test"]);
  assert.deepEqual(summary.providers, ["anthropic"]);
});

test("createBenchmarkClient throws when apiBaseUrl is missing", () => {
  assert.throws(
    () => createBenchmarkClient({ accessToken: "tkn" }),
    /apiBaseUrl is required/,
  );
});

test("createBenchmarkClient throws when accessToken is missing", () => {
  assert.throws(
    () => createBenchmarkClient({ apiBaseUrl: "http://127.0.0.1:3190" }),
    /accessToken is required/,
  );
});

test("createBenchmarkClient returns a method-bound client when given valid options", () => {
  const client = createBenchmarkClient({
    apiBaseUrl: "http://127.0.0.1:3190",
    accessToken: "abc",
    storageUrl: "http://127.0.0.1:3191",
    verbose: false,
  });
  assert.equal(client.apiBaseUrl, "http://127.0.0.1:3190");
  assert.equal(client.accessToken, "abc");
  assert.equal(client.storageUrl, "http://127.0.0.1:3191");
  assert.equal(client.verbose, false);
  assert.equal(typeof client.apiJson, "function");
  assert.equal(typeof client.ensureImportedAccessToken, "function");
  assert.equal(typeof client.storageJson, "function");
  assert.equal(typeof client.cleanupEntity, "function");
  assert.equal(typeof client.cleanupEntities, "function");
  assert.equal(typeof client.logStep, "function");
});

test("storageJson resolves to an empty array when no storageUrl is set", async () => {
  const client = createBenchmarkClient({
    apiBaseUrl: "http://127.0.0.1:3190",
    accessToken: "abc",
  });
  const events = await client.storageJson("session-id");
  assert.deepEqual(events, []);
});

test("runScenario is a function and rejects when options.client is missing", async () => {
  assert.equal(typeof runScenario, "function");
  await assert.rejects(
    () => runScenario({ id: "noop" }, {}),
    /client is required/,
  );
  await assert.rejects(
    () => runScenario({ id: "noop" }),
    /client is required/,
  );
});
