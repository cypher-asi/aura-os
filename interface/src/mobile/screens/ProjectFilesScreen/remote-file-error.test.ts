import { describe, expect, it } from "vitest";
import { ApiClientError } from "../../../shared/api/core";
import { getRemoteFileErrorDescription } from "./remote-file-error";

function apiError(status: number, message = "sensitive upstream path") {
  return new ApiClientError(status, { error: message, code: "upstream_error" });
}

describe("remote file error copy", () => {
  it("separates auth, path, and offline failures without leaking upstream details", () => {
    expect(getRemoteFileErrorDescription(apiError(401))).toContain("Sign in again");
    expect(getRemoteFileErrorDescription(apiError(403))).toContain("denied");
    expect(getRemoteFileErrorDescription(apiError(404))).toContain("Refresh the workspace");
    expect(getRemoteFileErrorDescription(apiError(413))).toContain("too large");
    expect(getRemoteFileErrorDescription(apiError(503))).toContain("workspace is offline");
    expect(getRemoteFileErrorDescription(apiError(503))).not.toContain("sensitive upstream path");
  });

  it("keeps an honest generic fallback for unclassified failures", () => {
    expect(getRemoteFileErrorDescription(new Error("network error"))).toContain("temporarily unavailable");
  });
});
