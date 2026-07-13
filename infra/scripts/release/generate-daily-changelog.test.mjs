import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertStrictToolModelSupport,
  batchCommits,
  buildAnthropicRequestBody,
  computeBackoffDelayMs,
  fetchAnthropicMessagesWithRetry,
  parseRetryAfterMs,
  preservePublishedEntryMedia,
  resolveChangelogDate,
  validateRenderedEntry,
} from "./generate-daily-changelog.mjs";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));
}

function buildFixtureBatches() {
  return batchCommits(readFixture("changelog-commits.json"), "America/Los_Angeles");
}

test("resolveChangelogDate keeps normal runs on the configured timezone date", () => {
  assert.equal(
    resolveChangelogDate("", {
      now: new Date("2026-07-10T06:30:00.000Z"),
      timeZone: "America/Los_Angeles",
    }),
    "2026-07-09",
  );
});

test("resolveChangelogDate accepts an explicit historical date", () => {
  assert.equal(
    resolveChangelogDate("2026-07-10", {
      now: new Date("2026-07-14T00:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    }),
    "2026-07-10",
  );
});

test("resolveChangelogDate rejects malformed and impossible dates", () => {
  assert.throws(
    () => resolveChangelogDate("2026-7-10"),
    /expected YYYY-MM-DD/,
  );
  assert.throws(
    () => resolveChangelogDate("2026-02-30"),
    /expected a real calendar date/,
  );
});

test("batchCommits groups the fixture history into stable Pacific-time sections", () => {
  const batches = buildFixtureBatches();

  assert.equal(batches.length, 4);
  assert.deepEqual(
    batches.map((batch) => batch.id),
    ["entry-1", "entry-2", "entry-3", "entry-4"],
  );
  assert.deepEqual(
    batches.map((batch) => batch.time_label),
    ["12:00 AM", "3:50 AM", "9:10 AM", "3:00 PM"],
  );
  assert.deepEqual(
    batches.map((batch) => batch.commits.length),
    [2, 2, 1, 1],
  );
});

test("validateRenderedEntry accepts the publication-ready fixture draft", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");

  const rendered = validateRenderedEntry(candidate, batches, 6);

  assert.equal(rendered.entries.length, 4);
  assert.equal(rendered.highlights.length, 4);
  assert.equal(rendered.entries[0].time_label, "12:00 AM");
  assert.equal(rendered.entries[1].items.length, 2);
});

test("validateRenderedEntry accepts a structurally valid generic draft", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-bad-generic-candidate.json");

  const rendered = validateRenderedEntry(candidate, batches, 6);

  assert.equal(rendered.entries.length, candidate.entries.length);
  assert.equal(rendered.highlights.length, candidate.highlights.length);
});

test("validateRenderedEntry rejects entries that reference unknown batches", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");
  candidate.entries[0].batch_id = "entry-999";

  assert.throws(
    () => validateRenderedEntry(candidate, batches, 6),
    /entry\.batch_id must reference a known batch/,
  );
});

test("validateRenderedEntry rejects bullets without valid SHAs from the batch", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");
  candidate.entries[0].items[0].commit_shas = ["not-a-real-sha"];

  assert.throws(
    () => validateRenderedEntry(candidate, batches, 6),
    /entry item must cite at least one SHA from batch entry-1/,
  );
});

test("validateRenderedEntry rejects duplicate batch entries", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");
  candidate.entries[1].batch_id = candidate.entries[0].batch_id;

  assert.throws(
    () => validateRenderedEntry(candidate, batches, 6),
    /entry\.batch_id must be unique/,
  );
});

test("assertStrictToolModelSupport warns instead of failing for non-allowlisted models", () => {
  assert.equal(assertStrictToolModelSupport("claude-sonnet-4-20250514"), false);
});

test("assertStrictToolModelSupport accepts Claude Opus 4.7", () => {
  assert.equal(assertStrictToolModelSupport("claude-opus-4-7"), true);
});

test("buildAnthropicRequestBody omits deprecated temperature and preserves tool mode", () => {
  const request = buildAnthropicRequestBody({
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
    systemPrompt: "system prompt",
    tool: { name: "submit_daily_changelog", input_schema: { type: "object" } },
    userPrompt: "user prompt",
    retryInstruction: null,
  });

  assert.equal(request.model, "claude-sonnet-4-6");
  assert.equal(request.max_tokens, 4096);
  assert.equal(request.tool_choice.type, "any");
  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0].content, "user prompt");
  assert.equal("temperature" in request, false);
});

test("buildAnthropicRequestBody includes retry guidance when requested", () => {
  const request = buildAnthropicRequestBody({
    model: "claude-sonnet-4-6",
    maxTokens: 6144,
    systemPrompt: "system prompt",
    tool: { name: "submit_daily_changelog", input_schema: { type: "object" } },
    userPrompt: "user prompt",
    retryInstruction: "validation failed",
  });

  assert.match(request.messages[0].content, /validation failed/);
  assert.match(request.messages[0].content, /Call the tool again with corrected input\./);
  assert.equal("temperature" in request, false);
});

test("preservePublishedEntryMedia carries published media across regenerated changelog entries", () => {
  const previousRendered = {
    entries: [{
      batch_id: "entry-1",
      title: "Model picker",
      items: [
        { text: "GPT-5.5 available", commit_shas: ["bbb", "aaa"] },
      ],
      media: {
        status: "published",
        assetPath: "assets/changelog/nightly/2026-04-24/model-picker.png",
        width: 3840,
        height: 2160,
      },
    }],
  };
  const regenerated = {
    entries: [{
      batch_id: "entry-1",
      title: "GPT-5.5 model picker",
      items: [
        { text: "GPT-5.5 is now visible in the chat model picker", commit_shas: ["aaa", "bbb"] },
      ],
    }],
  };

  const preserved = preservePublishedEntryMedia(regenerated, previousRendered);

  assert.equal(preserved.entries[0].media.status, "published");
  assert.equal(preserved.entries[0].media.assetPath, "assets/changelog/nightly/2026-04-24/model-picker.png");
});

test("preservePublishedEntryMedia does not carry media to unrelated regenerated entries", () => {
  const previousRendered = {
    entries: [{
      items: [{ text: "Agent composer", commit_shas: ["111"] }],
      media: { status: "published", assetPath: "assets/changelog/nightly/agent.png" },
    }],
  };
  const regenerated = {
    entries: [{
      items: [{ text: "Release hardening", commit_shas: ["222"] }],
    }],
  };

  const preserved = preservePublishedEntryMedia(regenerated, previousRendered);

  assert.equal(preserved.entries[0].media, undefined);
});

function makeJsonResponse({ status = 200, body = {}, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

test("fetchAnthropicMessagesWithRetry retries 529 and returns the eventual success", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return makeJsonResponse({
        status: 529,
        body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
      });
    }
    return makeJsonResponse({ status: 200, body: { ok: true } });
  };
  const sleeps = [];

  const response = await fetchAnthropicMessagesWithRetry(
    { model: "claude-test", max_tokens: 10, messages: [] },
    {
      fetchImpl,
      apiKey: "test-key",
      maxRetries: 3,
      baseDelayMs: 5,
      maxDelayMs: 20,
      sleepImpl: async (ms) => { sleeps.push(ms); },
      randomFn: () => 0.5,
      log: () => {},
    },
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 1, "should sleep at least one millisecond between attempts");
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], "test-key");
});

test("fetchAnthropicMessagesWithRetry exhausts retries on persistent 529", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return makeJsonResponse({
      status: 529,
      body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
    });
  };

  await assert.rejects(
    () => fetchAnthropicMessagesWithRetry(
      { model: "claude-test", max_tokens: 10, messages: [] },
      {
        fetchImpl,
        apiKey: "test-key",
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
        sleepImpl: async () => {},
        randomFn: () => 0.5,
        log: () => {},
      },
    ),
    /Anthropic request failed \(529\) after 3 attempts/,
  );
  assert.equal(callCount, 3);
});

test("fetchAnthropicMessagesWithRetry does not retry terminal 400 responses", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return makeJsonResponse({
      status: 400,
      body: { type: "error", error: { type: "invalid_request_error", message: "bad" } },
    });
  };

  await assert.rejects(
    () => fetchAnthropicMessagesWithRetry(
      { model: "claude-test", max_tokens: 10, messages: [] },
      {
        fetchImpl,
        apiKey: "test-key",
        maxRetries: 5,
        baseDelayMs: 1,
        maxDelayMs: 2,
        sleepImpl: async () => {},
        randomFn: () => 0.5,
        log: () => {},
      },
    ),
    /Anthropic request failed \(400\)/,
  );
  assert.equal(callCount, 1);
});

test("fetchAnthropicMessagesWithRetry honors retry-after-ms header when larger than backoff", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    if (callCount === 1) {
      return makeJsonResponse({
        status: 429,
        body: {},
        headers: { "retry-after-ms": "75" },
      });
    }
    return makeJsonResponse({ status: 200, body: { ok: true } });
  };
  const sleeps = [];

  const response = await fetchAnthropicMessagesWithRetry(
    { model: "claude-test", max_tokens: 10, messages: [] },
    {
      fetchImpl,
      apiKey: "test-key",
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 1000,
      sleepImpl: async (ms) => { sleeps.push(ms); },
      randomFn: () => 0.5,
      log: () => {},
    },
  );

  assert.equal(response.status, 200);
  assert.equal(callCount, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 75, `expected delay >= 75ms, saw ${sleeps[0]}`);
});

test("fetchAnthropicMessagesWithRetry retries network errors", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    if (callCount < 3) {
      throw new Error("ECONNRESET");
    }
    return makeJsonResponse({ status: 200, body: { ok: true } });
  };

  const response = await fetchAnthropicMessagesWithRetry(
    { model: "claude-test", max_tokens: 10, messages: [] },
    {
      fetchImpl,
      apiKey: "test-key",
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
      sleepImpl: async () => {},
      randomFn: () => 0.5,
      log: () => {},
    },
  );

  assert.equal(response.status, 200);
  assert.equal(callCount, 3);
});

test("computeBackoffDelayMs grows exponentially up to the cap with jitter", () => {
  const values = [1, 2, 3, 4, 5].map((attempt) => computeBackoffDelayMs(attempt, 100, 800, () => 1));
  // attempt 1: 100, 2: 200, 3: 400, 4: 800, 5: capped at 800
  assert.deepEqual(values, [100, 200, 400, 800, 800]);

  const halfJitter = computeBackoffDelayMs(3, 100, 10000, () => 0);
  // 0.5x of 400 = 200
  assert.equal(halfJitter, 200);
});

test("parseRetryAfterMs prefers retry-after-ms over retry-after seconds", () => {
  const headers = new Headers({ "retry-after-ms": "1500", "retry-after": "30" });
  assert.equal(parseRetryAfterMs(headers), 1500);

  const secondsOnly = new Headers({ "retry-after": "2" });
  assert.equal(parseRetryAfterMs(secondsOnly), 2000);

  const empty = new Headers();
  assert.equal(parseRetryAfterMs(empty), null);
});
