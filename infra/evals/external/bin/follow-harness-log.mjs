#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const POLL_MS = 500;

// Operators can opt back into raw passthrough for unmatched lines and
// chatty INFO fallthrough by exporting AURA_BENCH_HARNESS_LOG_VERBOSE=1.
// The default surface is intentionally narrow: drafting / queued / ok /
// failed plus startup banners and ERROR/WARN. Everything else is dropped
// so a single bench run reads as a clean timeline at a glance.
const VERBOSE = process.env.AURA_BENCH_HARNESS_LOG_VERBOSE === "1";

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

// The harness binary forces ANSI colors on `tracing` output even when its
// stderr is redirected to a file (RUST_LOG_STYLE/auto-detect both end up
// emitting CSI sequences in `harness.log`). Without stripping them every
// regex below — line shape, level extraction, key=value parsing — fails
// against the wrapped tokens (`\u001b[3mraw_input_bytes\u001b[0m\u001b[2m=\u001b[0m`)
// and we drop into the raw passthrough fallback for every line, which
// floods the operator with the noisy `tool_call_snapshot` stream we
// specifically exist to throttle.
const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;
function stripAnsi(value) {
  return value.replace(ANSI_PATTERN, "");
}

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

// `tracing` defaults to `<timestamp>  <LEVEL> <module::path>: <msg>`. We
// don't care about the module path and stripping it lets prefix matches
// like `rest.startsWith("forwarding tool_call_snapshot ")` work whether
// the binary was built with `.with_target(true)` or not.
const MODULE_PATH = /^[\w:]+:\s+/;
function stripModulePath(rest) {
  return rest.replace(MODULE_PATH, "");
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

// Whitelist of bare INFO messages we surface even when they don't carry
// structured fields. Anything not in this set is dropped at INFO unless
// VERBOSE is on. Match prefix-only so trailing `tracing` field bags
// (`key=val ...`) don't disqualify the line.
const INFO_BANNERS = [
  "LLM provider ready",
  "WebSocket connection opened",
  "harness session opened",
  "harness session closed",
  "opening harness session",
  "session ready",
  "listening on",
  "health check ok",
];

class Formatter {
  constructor(label) {
    this.label = label;
    // Per-tool 'drafting in progress' flag. Keyed by tool name (the
    // upstream snapshot log emits `tool=<name>` but no `tool_use_id`).
    // We emit one `drafting <tool>` line on first sight and drop every
    // subsequent snapshot for that tool until either the queued or
    // completed terminal event arrives, at which point the next call
    // can draft afresh. This is what keeps the operator from drowning
    // in per-token streaming noise without losing the "something is
    // happening" signal.
    this.drafting = new Set();
  }

  format(rawLine) {
    const stripped = stripAnsi(rawLine).replace(/\s+$/, "");
    // Tracing's `Pretty` formatter (and a few of our own indented
    // multiline emit sites) start with whitespace; `^(\S+)` would
    // otherwise route those straight to the raw passthrough.
    const line = stripped.replace(/^\s+/, "");
    const match = /^(\S+)\s+([A-Z]+)\s+(.*)$/.exec(line);
    if (!match) {
      return VERBOSE
        ? `${color.dim(`[${this.label}]`)} ${redact(line)}`
        : null;
    }

    const [, timestamp, level, rawRest] = match;
    const rest = stripModulePath(rawRest);

    if (level === "ERROR" || level === "WARN") {
      // Pass the un-stripped rest so `formatErrorLine` can still pull
      // the module path out as the `component` summary (e.g.
      // `aura_anthropic::client`).
      return formatErrorLine(this.label, timestamp, level, rawRest);
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
      this.drafting.delete(tool);
      return `${prefix(this.label, timestamp, level)} queued ${tool} (${isWrite ? "write" : "read"})`;
    }

    if (rest.startsWith("Tool call completed ")) {
      const tool = kv(rest, "tool_name") ?? "unknown_tool";
      const failed = kv(rest, "is_error") === "true";
      const resultLen = kv(rest, "result_len");
      const status = failed ? color.red("failed") : color.green("ok");
      const result = resultLen == null ? "" : ` ${bytes(resultLen)}`;
      this.drafting.delete(tool);
      return `${prefix(this.label, timestamp, level)} ${status} ${tool}${result}`;
    }

    if (INFO_BANNERS.some((banner) => rest.startsWith(banner))) {
      const head = rest.split(/\s+[a-z_]+=/)[0];
      return `${prefix(this.label, timestamp, level)} ${head}`;
    }

    return VERBOSE
      ? `${prefix(this.label, timestamp, level)} ${redact(rest)}`
      : null;
  }

  formatToolSnapshot(timestamp, level, rest) {
    const tool = kv(rest, "tool") ?? "unknown_tool";
    if (this.drafting.has(tool)) {
      return null;
    }
    this.drafting.add(tool);
    return `${prefix(this.label, timestamp, level)} drafting ${tool}`;
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
