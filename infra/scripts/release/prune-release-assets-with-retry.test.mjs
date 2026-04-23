import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
const scriptPath = new URL("./prune-release-assets-with-retry.sh", import.meta.url);

async function writeMockGh(root, scriptBody) {
  const binDir = path.join(root, "bin");
  const stateDir = path.join(root, "state");
  await mkdir(binDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const ghPath = path.join(binDir, "gh");
  await writeFile(ghPath, scriptBody, "utf8");
  await chmod(ghPath, 0o755);
  return { binDir, stateDir };
}

test("prunes nightly release assets with retries for transient GitHub API failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aura-release-prune-"));
  const stateDir = path.join(root, "state");
  const { binDir } = await writeMockGh(root, `#!/usr/bin/env bash
set -euo pipefail
state_dir="${stateDir}"
attempt_file="$state_dir/delete-attempts"
touch "$attempt_file"

if [[ "$1" != "api" ]]; then
  echo "unexpected command: $*" >&2
  exit 1
fi
shift

if [[ "$1" == "repos/cypher-asi/aura-os/releases/tags/nightly" ]]; then
  printf 'nightly-release-id\\n'
  exit 0
fi

if [[ "$1" == "--paginate" ]]; then
  shift
  if [[ "$1" == "repos/cypher-asi/aura-os/releases/nightly-release-id/assets" ]]; then
    printf 'asset-a\\nasset-b\\n'
    exit 0
  fi
fi

if [[ "$1" == "--silent" && "$2" == "-X" && "$3" == "DELETE" ]]; then
  endpoint="$4"
  count="$(grep -c "^$endpoint$" "$attempt_file" || true)"
  printf '%s\\n' "$endpoint" >> "$attempt_file"
  if [[ "$endpoint" == "repos/cypher-asi/aura-os/releases/assets/asset-a" && "$count" -eq 0 ]]; then
    echo 'gh: Server Error (HTTP 502)' >&2
    exit 1
  fi
  exit 0
fi

echo "unexpected gh api args: $*" >&2
exit 1
`);

  await execFile("bash", [scriptPath.pathname, "cypher-asi/aura-os", "nightly"], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GH_RELEASE_PRUNE_RETRY_DELAY_SECONDS: "0",
    },
  });

  const attempts = await readFile(path.join(stateDir, "delete-attempts"), "utf8");
  assert.equal(
    attempts.split("\n").filter((line) => line === "repos/cypher-asi/aura-os/releases/assets/asset-a").length,
    2,
  );
  assert.equal(
    attempts.split("\n").filter((line) => line === "repos/cypher-asi/aura-os/releases/assets/asset-b").length,
    1,
  );
});

test("treats missing assets as already pruned", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aura-release-prune-404-"));
  const { binDir } = await writeMockGh(root, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" != "api" ]]; then
  exit 1
fi
shift
if [[ "$1" == "repos/cypher-asi/aura-os/releases/tags/nightly" ]]; then
  printf 'nightly-release-id\\n'
  exit 0
fi
if [[ "$1" == "--paginate" ]]; then
  printf 'asset-gone\\n'
  exit 0
fi
if [[ "$1" == "--silent" && "$2" == "-X" && "$3" == "DELETE" ]]; then
  echo 'gh: Not Found (HTTP 404)' >&2
  exit 1
fi
exit 1
`);

  await execFile("bash", [scriptPath.pathname, "cypher-asi/aura-os", "nightly"], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GH_RELEASE_PRUNE_RETRY_DELAY_SECONDS: "0",
    },
  });
});
