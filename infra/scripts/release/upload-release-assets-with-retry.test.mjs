import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
const scriptPath = new URL("./upload-release-assets-with-retry.sh", import.meta.url);

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

async function seedSourceDir(root) {
  const sourceDir = path.join(root, "artifacts");
  await mkdir(sourceDir, { recursive: true });

  const completePath = path.join(sourceDir, "complete.dat");
  await writeFile(completePath, "complete-payload");

  const partialPath = path.join(sourceDir, "partial.txt");
  await writeFile(partialPath, "abc\n");

  const missingPath = path.join(sourceDir, "release-summary-linux-x86_64.json");
  await writeFile(missingPath, '{"channel":"linux"}\n');

  return { sourceDir, completePath, partialPath, missingPath };
}

test("uploads missing and wrong-sized assets and retries transient 'other side closed' failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aura-release-upload-"));
  const { sourceDir, completePath, partialPath, missingPath } = await seedSourceDir(root);

  const completeSize = (await readFile(completePath)).length;
  const stateDir = path.join(root, "state");

  const { binDir } = await writeMockGh(root, `#!/usr/bin/env bash
set -euo pipefail
state_dir="${stateDir}"
remote_file="$state_dir/remote-assets.tsv"
attempts_file="$state_dir/upload-attempts.log"
touch "$remote_file" "$attempts_file"

cmd="$1"
shift

if [[ "$cmd" == "api" ]]; then
  if [[ "$1" == "repos/cypher-asi/aura-os/releases/tags/v1.2.3" ]]; then
    printf 'release-1\\n'
    exit 0
  fi
  if [[ "$1" == "--paginate" ]]; then
    shift
    if [[ "$1" == "repos/cypher-asi/aura-os/releases/release-1/assets" ]]; then
      cat "$remote_file"
      exit 0
    fi
  fi
  echo "unexpected gh api call: $*" >&2
  exit 1
fi

if [[ "$cmd" == "release" && "$1" == "upload" ]]; then
  shift
  tag="$1"; shift
  file="$1"; shift
  name="$(basename "$file")"
  printf '%s\\n' "$name" >> "$attempts_file"
  attempt="$(grep -c "^$name$" "$attempts_file" || true)"

  if [[ "$name" == "release-summary-linux-x86_64.json" && "$attempt" -lt 2 ]]; then
    echo 'Error: other side closed' >&2
    exit 1
  fi

  size="$(wc -c < "$file" | tr -d ' \\t\\n')"
  if grep -q "^$name"$'\\t' "$remote_file"; then
    awk -v n="$name" -v s="$size" 'BEGIN{FS=OFS="\\t"} { if ($1==n) $2=s; print }' "$remote_file" > "$remote_file.tmp"
    mv "$remote_file.tmp" "$remote_file"
  else
    printf '%s\\t%s\\n' "$name" "$size" >> "$remote_file"
  fi
  exit 0
fi

echo "unexpected gh invocation: $cmd $*" >&2
exit 1
`);

  const remoteFile = path.join(stateDir, "remote-assets.tsv");
  await writeFile(
    remoteFile,
    `complete.dat\t${completeSize}\npartial.txt\t1\n`,
  );

  await execFile("bash", [scriptPath.pathname, "cypher-asi/aura-os", "v1.2.3", sourceDir], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GH_RELEASE_UPLOAD_RETRY_DELAY_SECONDS: "0",
    },
  });

  const attempts = (await readFile(path.join(stateDir, "upload-attempts.log"), "utf8"))
    .split("\n")
    .filter((line) => line.length > 0);

  assert.equal(
    attempts.filter((line) => line === "release-summary-linux-x86_64.json").length,
    2,
    "expected the missing asset to be retried exactly once after the transient failure",
  );
  assert.equal(
    attempts.filter((line) => line === "partial.txt").length,
    1,
    "expected the size-mismatched asset to be re-uploaded exactly once",
  );
  assert.equal(
    attempts.filter((line) => line === "complete.dat").length,
    0,
    "expected the already-present asset to be left alone",
  );

  const finalRemote = await readFile(remoteFile, "utf8");
  const sizes = Object.fromEntries(
    finalRemote
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, size] = line.split("\t");
        return [name, Number(size)];
      }),
  );
  const partialSize = (await readFile(partialPath)).length;
  const missingSize = (await readFile(missingPath)).length;
  assert.equal(sizes["complete.dat"], completeSize);
  assert.equal(sizes["partial.txt"], partialSize);
  assert.equal(sizes["release-summary-linux-x86_64.json"], missingSize);
});

test("retries a transient failure while resolving the release", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aura-release-lookup-"));
  const { sourceDir, completePath, partialPath, missingPath } = await seedSourceDir(root);
  const completeSize = (await readFile(completePath)).length;
  const partialSize = (await readFile(partialPath)).length;
  const missingSize = (await readFile(missingPath)).length;
  const stateDir = path.join(root, "state");

  const { binDir } = await writeMockGh(root, `#!/usr/bin/env bash
set -euo pipefail
state_dir="${stateDir}"
attempts_file="$state_dir/lookup-attempts.log"
touch "$attempts_file"

cmd="$1"
shift

if [[ "$cmd" == "api" ]]; then
  if [[ "$1" == "repos/cypher-asi/aura-os/releases/tags/v1.2.3" ]]; then
    printf 'lookup\\n' >> "$attempts_file"
    attempt="$(wc -l < "$attempts_file" | tr -d ' \\t\\n')"
    if [[ "$attempt" -eq 1 ]]; then
      echo 'HTTP 503: No server is currently available' >&2
      exit 1
    fi
    if [[ "$attempt" -eq 2 ]]; then
      echo "invalid character '<' looking for beginning of value" >&2
      exit 1
    fi
    printf 'release-1\\n'
    exit 0
  fi
  if [[ "$1" == "--paginate" ]]; then
    printf 'complete.dat\\t${completeSize}\\npartial.txt\\t${partialSize}\\nrelease-summary-linux-x86_64.json\\t${missingSize}\\n'
    exit 0
  fi
fi

echo "unexpected gh invocation: $cmd $*" >&2
exit 1
`);

  const result = await execFile(
    "bash",
    [scriptPath.pathname, "cypher-asi/aura-os", "v1.2.3", sourceDir],
    {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        GH_RELEASE_UPLOAD_RETRY_DELAY_SECONDS: "0",
      },
    },
  );

  const attempts = (await readFile(path.join(stateDir, "lookup-attempts.log"), "utf8"))
    .split("\n")
    .filter((line) => line.length > 0);
  assert.equal(attempts.length, 3);
  assert.match(result.stderr, /Transient GitHub API failure \(attempt 1\/5\)/);
  assert.match(result.stderr, /Transient GitHub API failure \(attempt 2\/5\)/);
});

test("exits non-zero with a clear diff when assets remain missing after max attempts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aura-release-upload-fail-"));
  const { sourceDir } = await seedSourceDir(root);
  const stateDir = path.join(root, "state");

  const { binDir } = await writeMockGh(root, `#!/usr/bin/env bash
set -euo pipefail
state_dir="${stateDir}"
remote_file="$state_dir/remote-assets.tsv"
attempts_file="$state_dir/upload-attempts.log"
touch "$remote_file" "$attempts_file"

cmd="$1"
shift

if [[ "$cmd" == "api" ]]; then
  if [[ "$1" == "repos/cypher-asi/aura-os/releases/tags/v1.2.3" ]]; then
    printf 'release-1\\n'
    exit 0
  fi
  if [[ "$1" == "--paginate" ]]; then
    cat "$remote_file"
    exit 0
  fi
  exit 1
fi

if [[ "$cmd" == "release" && "$1" == "upload" ]]; then
  shift
  shift
  file="$1"
  printf '%s\\n' "$(basename "$file")" >> "$attempts_file"
  echo 'Error: other side closed' >&2
  exit 1
fi

exit 1
`);

  await writeFile(path.join(stateDir, "remote-assets.tsv"), "");

  let caught;
  try {
    await execFile("bash", [scriptPath.pathname, "cypher-asi/aura-os", "v1.2.3", sourceDir], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        GH_RELEASE_UPLOAD_RETRY_DELAY_SECONDS: "0",
        GH_RELEASE_UPLOAD_MAX_ATTEMPTS: "2",
      },
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, "expected the script to exit non-zero when reconcile cannot complete");
  assert.equal(caught.code, 1);
  assert.match(String(caught.stderr ?? ""), /still missing/);
  assert.match(String(caught.stderr ?? ""), /release-summary-linux-x86_64\.json/);

  const attempts = (await readFile(path.join(stateDir, "upload-attempts.log"), "utf8"))
    .split("\n")
    .filter((line) => line.length > 0);
  assert.equal(
    attempts.filter((line) => line === "release-summary-linux-x86_64.json").length,
    2,
    "expected exactly GH_RELEASE_UPLOAD_MAX_ATTEMPTS upload attempts for the failing asset",
  );
});

test("treats an already-complete release as a no-op", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aura-release-upload-noop-"));
  const { sourceDir, completePath, partialPath, missingPath } = await seedSourceDir(root);

  const completeSize = (await readFile(completePath)).length;
  const partialSize = (await readFile(partialPath)).length;
  const missingSize = (await readFile(missingPath)).length;
  const stateDir = path.join(root, "state");

  const { binDir } = await writeMockGh(root, `#!/usr/bin/env bash
set -euo pipefail
state_dir="${stateDir}"
attempts_file="$state_dir/upload-attempts.log"
touch "$attempts_file"

cmd="$1"
shift

if [[ "$cmd" == "api" ]]; then
  if [[ "$1" == "repos/cypher-asi/aura-os/releases/tags/v1.2.3" ]]; then
    printf 'release-1\\n'
    exit 0
  fi
  if [[ "$1" == "--paginate" ]]; then
    printf 'complete.dat\\t${completeSize}\\npartial.txt\\t${partialSize}\\nrelease-summary-linux-x86_64.json\\t${missingSize}\\n'
    exit 0
  fi
  exit 1
fi

if [[ "$cmd" == "release" && "$1" == "upload" ]]; then
  shift
  shift
  file="$1"
  printf '%s\\n' "$(basename "$file")" >> "$attempts_file"
  exit 0
fi

exit 1
`);

  await execFile("bash", [scriptPath.pathname, "cypher-asi/aura-os", "v1.2.3", sourceDir], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GH_RELEASE_UPLOAD_RETRY_DELAY_SECONDS: "0",
    },
  });

  const attempts = await readFile(path.join(stateDir, "upload-attempts.log"), "utf8");
  assert.equal(attempts.trim(), "", "expected no uploads when the release already matches local artifacts");
});
