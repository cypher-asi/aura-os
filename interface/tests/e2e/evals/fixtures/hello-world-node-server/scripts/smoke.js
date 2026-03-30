const { spawn } = require("node:child_process");

const port = String(4300 + Math.floor(Math.random() * 200));
const child = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: port },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until the server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for server. Output:\n${output}`);
}

async function main() {
  try {
    await waitForServer(`http://127.0.0.1:${port}/health`, 10_000);

    const home = await fetch(`http://127.0.0.1:${port}/`);
    const homeHtml = await home.text();
    if (!home.ok || !homeHtml.includes("Aura Eval Server") || !homeHtml.includes("Built by Aura")) {
      throw new Error(`Homepage verification failed. Status=${home.status}\n${homeHtml}`);
    }

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const healthJson = await health.json();
    if (!health.ok || healthJson.status !== "ok" || healthJson.service !== "aura-eval") {
      throw new Error(`Health verification failed: ${JSON.stringify(healthJson)}`);
    }

    console.log("Node server benchmark smoke test passed.");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  child.kill("SIGTERM");
  process.exit(1);
});
