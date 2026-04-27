#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const POLL_MS = 500;
const SNAPSHOT_MIN_MS = 1500;
const SNAPSHOT_MIN_BYTES = 1024;

function parseArgs(argv) {
  const args = {
    file: null,
    fromEnd: false,
    label: "harness",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case "--file":
        args.file = next();
        break;
      case "--from-end":
        args.fromEnd = true;
        break;
      case "--label":
        args.label = next();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.file) {
    throw new Error("--file is required");
  }

  return args;
}

const useColor = process.stderr.isTTY && process.env.NO_COLOR !== "1";
const color = {
  dim: (value) => useColor ? `\x1b[2m${value}\x1b[0m` : value,
  red: (value) => useColor ? `\x1b[31m${value}\x1b[0m` : value,
  yellow: (value) => useColor ? `\x1b[33m${value}\x1b[0m` : value,
  green: (value) => useColor ? `\x1b[32m${value}\x1b[0m` : value,
  cyan: (value) => useColor ? `\x1b[36m${value}\x1b[0m` : value,
};

function redact(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer <redacted>")
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|JWT|SECRET|API_KEY)[A-Z0-9_]*=)[^\s,"]+/gi,
      "$1<redacted>",
    )
    .replace(
      /(["']?(?:authorization|token|jwt|secret|api_key)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi,
      "$1<redacted>$3",
    );
}

function bytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1024) return `${n}B`;
  return `${(n / 1024).toFixed(1)}KB`;
}

function shortTime(timestamp) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(timestamp);
  return match ? match[2] : timestamp;
}

function kv(rest, key) {
  const match = new RegExp(`(?:^|\\s)${key}=("[^"]*"|\\S+)`).exec(rest);
  if (!match) return null;
  const raw = match[1];
  return raw.startsWith("\"") && raw.endsWith("\"") ? raw.slice(1, -1) : raw;
}

function prefix(label, timestamp, level) {
  const time = color.dim(shortTime(timestamp));
  const levelText = level === "ERROR"
    ? color.red(level)
    : level === "WARN"
      ? color.yellow(level)
      : color.dim(level);
  return `[${color.cyan(label)} ${time} ${levelText}]`;
}

function formatErrorLine(label, timestamp, level, rest) {
  const model = /\{model=([^}]+)\}/.exec(rest)?.[1];
  const status = /status=([0-9]{3}\s+[A-Za-z]+)/.exec(rest)?.[1];
  const isCloudflareHtml = /body=<!DOCTYPE html>|Cloudflare block/i.test(rest);
  const component = rest.split(":")[0]?.trim();
  const parts = [];
  if (component) parts.push(component);
  if (model) parts.push(`model=${model}`);
  if (status) parts.push(`status=${status}`);
  if (isCloudflareHtml) parts.push("cloudflare_html=true");
  const summary = parts.length > 0 ? parts.join(" ") : redact(rest);
  return `${prefix(label, timestamp, level)} ${summary}`;
}

class Formatter {
  constructor(label) {
    this.label = label;
    this.snapshots = new Map();
  }

  format(line) {
    const match = /^(\S+)\s+([A-Z]+)\s+(.*)$/.exec(line);
    if (!match) {
      return `${color.dim(`[${this.label}]`)} ${redact(line)}`;
    }

    const [, timestamp, level, rest] = match;

    if (level === "ERROR" || level === "WARN") {
      return formatErrorLine(this.label, timestamp, level, rest);
    }

    if (rest.startsWith("forwarding tool_call_snapshot ")) {
      return this.formatToolSnapshot(timestamp, level, rest);
    }

    if (rest.startsWith("Processing tool_use stop reason ")) {
      const count = kv(rest, "tool_count") ?? "?";
      return `${prefix(this.label, timestamp, level)} model requested ${count} tool call(s)`;
    }

    if (rest.startsWith("Tool requested by model ")) {
      const tool = kv(rest, "tool_name") ?? "unknown_tool";
      const isWrite = kv(rest, "is_write") === "true";
      return `${prefix(this.label, timestamp, level)} queued ${tool} (${isWrite ? "write" : "read"})`;
    }

    if (rest.startsWith("Tool call completed ")) {
      const tool = kv(rest, "tool_name") ?? "unknown_tool";
      const failed = kv(rest, "is_error") === "true";
      const resultLen = kv(rest, "result_len");
      const status = failed ? color.red("failed") : color.green("ok");
      const result = resultLen == null ? "" : ` result=${bytes(resultLen)}`;
      return `${prefix(this.label, timestamp, level)} ${status} ${tool}${result}`;
    }

    if (
      /LLM provider ready|WebSocket connection opened|session|health|started|listening/i.test(rest)
    ) {
      return `${prefix(this.label, timestamp, level)} ${redact(rest)}`;
    }

    return null;
  }

  formatToolSnapshot(timestamp, level, rest) {
    const tool = kv(rest, "tool") ?? "unknown_tool";
    const rawBytes = Number(kv(rest, "raw_input_bytes") ?? 0);
    const markdownLen = Number(kv(rest, "markdown_len") ?? 0);
    const contentLen = Number(kv(rest, "content_len") ?? 0);
    const now = Date.parse(timestamp);
    const previous = this.snapshots.get(tool);

    if (
      previous
      && Number.isFinite(now)
      && now - previous.timestampMs < SNAPSHOT_MIN_MS
      && Math.abs(markdownLen - previous.markdownLen) < SNAPSHOT_MIN_BYTES
      && Math.abs(contentLen - previous.contentLen) < SNAPSHOT_MIN_BYTES
    ) {
      return null;
    }

    this.snapshots.set(tool, {
      timestampMs: Number.isFinite(now) ? now : Date.now(),
      markdownLen,
      contentLen,
    });

    const draft = markdownLen > 0
      ? `markdown=${bytes(markdownLen)}`
      : contentLen > 0
        ? `content=${bytes(contentLen)}`
        : `input=${bytes(rawBytes)}`;
    return `${prefix(this.label, timestamp, level)} drafting ${tool} ${draft}`;
  }
}

async function fileSize(file) {
  try {
    return (await fs.stat(file)).size;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readNew(file, offset) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (stat.size < offset) {
      offset = 0;
    }
    if (stat.size === offset) {
      return { offset, text: "" };
    }
    const length = stat.size - offset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    return { offset: stat.size, text: buffer.toString("utf8") };
  } finally {
    await handle.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = path.resolve(args.file);
  const formatter = new Formatter(args.label);
  let offset = 0;
  let pending = "";
  let announcedMissing = false;
  let stopping = false;

  const initialSize = await fileSize(file);
  if (initialSize == null) {
    process.stderr.write(`[${args.label}] waiting for ${file}\n`);
    announcedMissing = true;
  } else if (args.fromEnd) {
    offset = initialSize;
  }

  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });

  while (!stopping) {
    try {
      const size = await fileSize(file);
      if (size == null) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        continue;
      }
      if (announcedMissing) {
        process.stderr.write(`[${args.label}] following ${file}\n`);
        announcedMissing = false;
      }
      const result = await readNew(file, offset);
      offset = result.offset;
      if (result.text) {
        const lines = (pending + result.text).split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const formatted = formatter.format(line);
          if (formatted) {
            process.stderr.write(`${formatted}\n`);
          }
        }
      }
    } catch (error) {
      process.stderr.write(`[${args.label}] log follower error: ${error.message}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  process.stderr.write(`[harness] fatal log follower error: ${error.message}\n`);
  process.exit(1);
});
