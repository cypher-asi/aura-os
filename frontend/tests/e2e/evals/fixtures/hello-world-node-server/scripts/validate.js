const fs = require("node:fs");
const path = require("node:path");

const serverPath = path.join(process.cwd(), "server.js");

if (!fs.existsSync(serverPath)) {
  console.error("Expected server.js to exist.");
  process.exit(1);
}

const source = fs.readFileSync(serverPath, "utf8");

const checks = [
  { label: "http import", passed: source.includes("node:http") || source.includes("require(\"http\")") || source.includes("require('http')") },
  { label: "port env", passed: source.includes("process.env.PORT") },
  { label: "root heading", passed: source.includes("Aura Eval Server") },
  { label: "homepage text", passed: source.includes("Built by Aura") },
  { label: "health route", passed: source.includes("/health") && source.includes("aura-eval") },
];

const failures = checks.filter((check) => !check.passed);

if (failures.length > 0) {
  console.error(`Validation failed for: ${failures.map((check) => check.label).join(", ")}`);
  process.exit(1);
}

console.log("Node server benchmark fixture validated successfully.");
