#!/usr/bin/env node

import { stdin, stderr, stdout } from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const command = process.argv[2];

if (command !== "list-tools" && command !== "call-tool") {
  stderr.write("Usage: aura-trusted-mcp.mjs <list-tools|call-tool>\n");
  process.exit(1);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stdin.on("data", (chunk) => chunks.push(chunk));
    stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stdin.on("error", reject);
  });
}

function configObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function expandTemplateString(value) {
  return String(value).replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => process.env[name] ?? match);
}

function expandConfigTemplates(value) {
  if (typeof value === "string") return expandTemplateString(value);
  if (Array.isArray(value)) return value.map((entry) => expandConfigTemplates(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expandConfigTemplates(entry)]),
    );
  }
  return value;
}

function normalizeArgs(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value.trim()) return value.trim().split(/\s+/);
  return [];
}

function transportKind(config) {
  const transport = String(config.transport ?? "").trim().toLowerCase();
  if (transport === "http" || transport === "streamable_http") return "http";
  if (transport === "stdio") return "stdio";
  throw new Error(`Unsupported MCP transport: ${transport || "missing"}`);
}

async function connect(integration, secret) {
  const config = configObject(expandConfigTemplates(integration.provider_config));
  const transport = transportKind(config);
  const client = new Client({
    name: "aura-trusted-mcp-bridge",
    version: "0.1.0",
  });

  let clientTransport;
  if (transport === "http") {
    if (typeof config.url !== "string" || !config.url.trim()) {
      throw new Error("HTTP MCP integrations require provider_config.url");
    }
    const headers = {};
    if (typeof secret === "string" && secret.trim()) {
      headers.Authorization = `Bearer ${secret.trim()}`;
    }
    clientTransport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
    });
  } else {
    if (typeof config.command !== "string" || !config.command.trim()) {
      throw new Error("stdio MCP integrations require provider_config.command");
    }
    const env = configObject(config.env);
    if (
      typeof secret === "string" &&
      secret.trim() &&
      typeof config.secretEnvVar === "string" &&
      config.secretEnvVar.trim()
    ) {
      env[config.secretEnvVar.trim()] = secret.trim();
    }
    clientTransport = new StdioClientTransport({
      command: config.command.trim(),
      args: normalizeArgs(config.args),
      cwd: typeof config.cwd === "string" && config.cwd.trim() ? config.cwd.trim() : undefined,
      env,
      stderr: "pipe",
    });
  }

  await client.connect(clientTransport);
  return { client, clientTransport };
}

function normalizedInputSchema(tool) {
  return tool?.inputSchema && typeof tool.inputSchema === "object"
    ? tool.inputSchema
    : { type: "object", additionalProperties: true };
}

async function main() {
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const integration = payload.integration;
  if (!integration || typeof integration !== "object") {
    throw new Error("Missing integration payload");
  }

  const { client, clientTransport } = await connect(integration, payload.secret);
  try {
    if (command === "list-tools") {
      const result = await client.listTools();
      stdout.write(
        JSON.stringify(
          (result.tools ?? []).map((tool) => ({
            originalName: tool.name,
            description: tool.description ?? tool.name,
            inputSchema: normalizedInputSchema(tool),
          })),
        ),
      );
      return;
    }

    if (typeof payload.toolName !== "string" || !payload.toolName.trim()) {
      throw new Error("call-tool requires toolName");
    }
    const result = await client.callTool({
      name: payload.toolName,
      arguments: payload.args && typeof payload.args === "object" ? payload.args : {},
    });
    stdout.write(JSON.stringify(result));
  } finally {
    await client.close().catch(() => {});
    await clientTransport.close?.().catch?.(() => {});
  }
}

main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
