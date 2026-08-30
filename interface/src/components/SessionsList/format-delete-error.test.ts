import { describe, expect, it } from "vitest";
import { ApiClientError } from "../../shared/api/core";
import {
  formatDeleteSessionError,
  formatSessionActionError,
} from "./format-delete-error";

describe("formatDeleteSessionError", () => {
  it("includes the upstream HTTP status and server message for ApiClientError", () => {
    const err = new ApiClientError(409, {
      error: "session has unfinished tasks",
      code: "session_in_use",
      details: null,
    });
    expect(formatDeleteSessionError(err)).toBe(
      "Couldn't delete session (409): session has unfinished tasks",
    );
  });

  it("falls back to the error code when the body has no message", () => {
    const err = new ApiClientError(502, {
      error: "",
      code: "bad_gateway",
      details: null,
    });
    expect(formatDeleteSessionError(err)).toBe(
      "Couldn't delete session (502): bad_gateway",
    );
  });

  it("uses Error.message for plain Error instances", () => {
    expect(formatDeleteSessionError(new Error("network down"))).toBe(
      "Couldn't delete session: network down",
    );
  });

  it("returns a generic line for unknown error shapes", () => {
    expect(formatDeleteSessionError(undefined)).toBe(
      "Couldn't delete session.",
    );
    expect(formatDeleteSessionError("plain string")).toBe(
      "Couldn't delete session.",
    );
  });

  it("formats archive and restore failures with the requested action", () => {
    expect(formatSessionActionError("archive", new Error("offline"))).toBe(
      "Couldn't archive session: offline",
    );
    expect(formatSessionActionError("restore", undefined)).toBe(
      "Couldn't restore session.",
    );
  });
});
