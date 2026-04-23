import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFile = promisify(execFileCallback);
const scriptPath = new URL("./commit-gh-pages-with-retry.sh", import.meta.url);

async function git(cwd, args) {
  return execFile("git", args, { cwd });
}

async function configureGit(cwd) {
  await git(cwd, ["config", "user.name", "Test Bot"]);
  await git(cwd, ["config", "user.email", "test@example.com"]);
}

test("rebases and pushes generated gh-pages changes when the remote moved first", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aura-gh-pages-push-"));
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const worker = path.join(root, "worker");
  const racer = path.join(root, "racer");
  const inspect = path.join(root, "inspect");

  await git(root, ["init", "--bare", remote]);
  await git(root, ["clone", remote, seed]);
  await configureGit(seed);
  await git(seed, ["checkout", "-b", "gh-pages"]);
  await mkdir(path.join(seed, "changelog", "nightly"), { recursive: true });
  await writeFile(path.join(seed, "changelog", "nightly", "latest.md"), "Initial changelog\n");
  await git(seed, ["add", "changelog/nightly/latest.md"]);
  await git(seed, ["commit", "-m", "Seed gh-pages"]);
  await git(seed, ["push", "-u", "origin", "gh-pages"]);
  await git(remote, ["symbolic-ref", "HEAD", "refs/heads/gh-pages"]);

  await git(root, ["clone", remote, worker]);
  await git(root, ["clone", remote, racer]);
  await configureGit(racer);

  await writeFile(path.join(racer, "from-racer.txt"), "remote moved first\n");
  await git(racer, ["add", "from-racer.txt"]);
  await git(racer, ["commit", "-m", "Move gh-pages remotely"]);
  await git(racer, ["push"]);

  await mkdir(path.join(worker, "assets", "changelog", "nightly"), { recursive: true });
  await writeFile(path.join(worker, "assets", "changelog", "nightly", "demo.png"), "png\n");

  await execFile("bash", [
    scriptPath.pathname,
    worker,
    "Publish generated media",
    "assets/changelog/nightly",
  ]);

  await git(root, ["clone", remote, inspect]);
  assert.equal(
    await readFile(path.join(inspect, "from-racer.txt"), "utf8"),
    "remote moved first\n",
  );
  assert.equal(
    await readFile(path.join(inspect, "assets", "changelog", "nightly", "demo.png"), "utf8"),
    "png\n",
  );
});

test("creates an allow-empty gh-pages republish commit when requested", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aura-gh-pages-empty-"));
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const worker = path.join(root, "worker");
  const inspect = path.join(root, "inspect");

  await git(root, ["init", "--bare", remote]);
  await git(root, ["clone", remote, seed]);
  await configureGit(seed);
  await git(seed, ["checkout", "-b", "gh-pages"]);
  await mkdir(path.join(seed, "changelog", "nightly"), { recursive: true });
  await writeFile(path.join(seed, "changelog", "nightly", "latest.md"), "Initial changelog\n");
  await git(seed, ["add", "changelog/nightly/latest.md"]);
  await git(seed, ["commit", "-m", "Seed gh-pages"]);
  await git(seed, ["push", "-u", "origin", "gh-pages"]);
  await git(remote, ["symbolic-ref", "HEAD", "refs/heads/gh-pages"]);

  await git(root, ["clone", remote, worker]);

  await execFile("bash", [
    scriptPath.pathname,
    worker,
    "Republish gh-pages",
  ], {
    env: {
      ...process.env,
      GH_PAGES_ALLOW_EMPTY: "1",
    },
  });

  await git(root, ["clone", remote, inspect]);
  const { stdout } = await git(inspect, ["log", "--oneline", "-n", "2"]);
  assert.match(stdout, /Republish gh-pages/);
  assert.equal(
    await readFile(path.join(inspect, "changelog", "nightly", "latest.md"), "utf8"),
    "Initial changelog\n",
  );
});
