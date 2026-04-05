import { ApiClientError } from "../api/core";
import { getApiErrorMessage, getAuthErrorMessage } from "./api-errors";

function makeApiError(
  status: number,
  error: string,
  code = "unknown",
): ApiClientError {
  return new ApiClientError(status, { error, code, details: null });
}

describe("getApiErrorMessage", () => {
  it("returns body.error for a simple ApiClientError", () => {
    const err = makeApiError(400, "Something went wrong");
    expect(getApiErrorMessage(err)).toBe("Something went wrong");
  });

  it("parses nested JSON and extracts the inner message", () => {
    const nested = JSON.stringify({
      error: { message: "Bad request: field X is required" },
    });
    const err = makeApiError(400, nested);
    expect(getApiErrorMessage(err)).toBe("field X is required");
  });

  it("returns nested message as-is when it has no Bad request prefix", () => {
    const nested = JSON.stringify({
      error: { message: "Rate limit exceeded" },
    });
    const err = makeApiError(429, nested);
    expect(getApiErrorMessage(err)).toBe("Rate limit exceeded");
  });

  it("falls back to body.error when nested JSON has no message", () => {
    const nested = JSON.stringify({ error: {} });
    const err = makeApiError(400, nested);
    expect(getApiErrorMessage(err)).toBe(nested);
  });

  it("falls back to body.error when body.error is not valid JSON", () => {
    const err = makeApiError(400, "plain text error");
    expect(getApiErrorMessage(err)).toBe("plain text error");
  });

  it("returns message from a regular Error", () => {
    expect(getApiErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns fallback for a string", () => {
    expect(getApiErrorMessage("oops")).toBe("An unexpected error occurred");
  });

  it("returns fallback for a plain object", () => {
    expect(getApiErrorMessage({ foo: "bar" })).toBe(
      "An unexpected error occurred",
    );
  });

  it("returns fallback for null", () => {
    expect(getApiErrorMessage(null)).toBe("An unexpected error occurred");
  });

  it("returns fallback for undefined", () => {
    expect(getApiErrorMessage(undefined)).toBe("An unexpected error occurred");
  });
});

describe("getAuthErrorMessage", () => {
  const host = "localhost:9090";

  it("returns credential message for 401", () => {
    const err = makeApiError(401, "Unauthorized");
    expect(getAuthErrorMessage(err, host)).toBe(
      "Email or password incorrect.",
    );
  });

  it("returns duplicate-account message for 409", () => {
    const err = makeApiError(409, "Conflict");
    expect(getAuthErrorMessage(err, host)).toBe(
      "An account with that email already exists.",
    );
  });

  it.each([502, 503, 504])(
    "returns unreachable-host message for %i",
    (status) => {
      const err = makeApiError(status, "Gateway error");
      expect(getAuthErrorMessage(err, host)).toBe(
        `Can't reach Aura host at ${host}. Check the host target and try again.`,
      );
    },
  );

  it("falls back to body.error for other API status codes", () => {
    const err = makeApiError(422, "Validation failed");
    expect(getAuthErrorMessage(err, host)).toBe("Validation failed");
  });

  it("detects fetch/network errors and returns unreachable-host message", () => {
    expect(
      getAuthErrorMessage(new TypeError("Failed to fetch"), host),
    ).toBe(
      `Can't reach Aura host at ${host}. Check the host target and try again.`,
    );
  });

  it("detects 'network error' phrasing", () => {
    expect(
      getAuthErrorMessage(new Error("network error"), host),
    ).toBe(
      `Can't reach Aura host at ${host}. Check the host target and try again.`,
    );
  });

  it("detects 'Load failed' phrasing (Safari)", () => {
    expect(
      getAuthErrorMessage(new Error("Load failed"), host),
    ).toBe(
      `Can't reach Aura host at ${host}. Check the host target and try again.`,
    );
  });

  it("returns generic Error message when it is not network-related", () => {
    expect(getAuthErrorMessage(new Error("disk full"), host)).toBe(
      "disk full",
    );
  });

  it("returns fallback for unknown types", () => {
    expect(getAuthErrorMessage(42, host)).toBe(
      "An unexpected error occurred",
    );
  });
});
