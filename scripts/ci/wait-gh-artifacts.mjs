#!/usr/bin/env node

const args = process.argv.slice(2);

const artifacts = [];
const failJobs = [];
let intervalMs = 15_000;
let timeoutMs = 45 * 60_000;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const value = args[index + 1];
  if (arg === "--artifact") {
    artifacts.push(value);
    index += 1;
  } else if (arg === "--fail-job") {
    failJobs.push(value);
    index += 1;
  } else if (arg === "--interval-seconds") {
    intervalMs = Number(value) * 1000;
    index += 1;
  } else if (arg === "--timeout-seconds") {
    timeoutMs = Number(value) * 1000;
    index += 1;
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

if (artifacts.length === 0) {
  throw new Error("At least one --artifact is required");
}

const repository = process.env.GITHUB_REPOSITORY;
const runId = process.env.GITHUB_RUN_ID;
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";

if (!repository || !runId || !token) {
  throw new Error("GITHUB_REPOSITORY, GITHUB_RUN_ID, and GITHUB_TOKEN/GH_TOKEN are required");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function githubApi(pathname, query = {}) {
  const url = new URL(`${apiBase}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
  }

  return response.json();
}

async function listAll(pathname, key) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const payload = await githubApi(pathname, { per_page: 100, page });
    const pageItems = payload[key] ?? [];
    items.push(...pageItems);
    if (pageItems.length < 100) {
      return items;
    }
  }
}

async function snapshot() {
  const [artifactItems, jobItems] = await Promise.all([
    listAll(`/repos/${repository}/actions/runs/${runId}/artifacts`, "artifacts"),
    listAll(`/repos/${repository}/actions/runs/${runId}/jobs`, "jobs"),
  ]);

  const artifactNames = new Set(
    artifactItems.filter((artifact) => !artifact.expired).map((artifact) => artifact.name),
  );
  const jobsByName = new Map(jobItems.map((job) => [job.name, job]));

  return { artifactNames, jobsByName };
}

const deadline = Date.now() + timeoutMs;
let lastStatus = "";

while (Date.now() < deadline) {
  const { artifactNames, jobsByName } = await snapshot();
  const missingArtifacts = artifacts.filter((name) => !artifactNames.has(name));
  const failedJobs = failJobs
    .map((name) => jobsByName.get(name))
    .filter((job) => job?.status === "completed" && job.conclusion !== "success" && job.conclusion !== "skipped");

  if (failedJobs.length > 0) {
    for (const job of failedJobs) {
      console.error(`Required producer job failed: ${job.name} (${job.conclusion})`);
    }
    process.exit(1);
  }

  if (missingArtifacts.length === 0) {
    console.log(`Found required artifacts: ${artifacts.join(", ")}`);
    process.exit(0);
  }

  const producerStatus = failJobs
    .map((name) => {
      const job = jobsByName.get(name);
      return `${name}: ${job?.status ?? "not-created"}${job?.conclusion ? `/${job.conclusion}` : ""}`;
    })
    .join("; ");
  const status = `Waiting for artifacts: ${missingArtifacts.join(", ")}. ${producerStatus}`;
  if (status !== lastStatus) {
    console.log(status);
    lastStatus = status;
  }
  await sleep(intervalMs);
}

console.error(`Timed out waiting for artifacts: ${artifacts.join(", ")}`);
process.exit(1);
