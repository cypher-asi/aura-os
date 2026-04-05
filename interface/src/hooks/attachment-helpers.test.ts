import { buildContentBlocks, buildAttachmentLabel } from "./attachment-helpers";

describe("buildContentBlocks", () => {
  it("returns undefined when attachments are undefined", () => {
    expect(buildContentBlocks("hello", undefined)).toBeUndefined();
  });

  it("returns undefined when attachments array is empty", () => {
    expect(buildContentBlocks("hello", [])).toBeUndefined();
  });

  it("includes text block and decoded text attachment", () => {
    const encoded = btoa("file content here");
    const result = buildContentBlocks("hello", [
      { type: "text", media_type: "text/plain", data: encoded, name: "readme.md" },
    ]);

    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ type: "text", text: "hello" });
    expect(result![1]).toEqual({
      type: "text",
      text: "[File: readme.md]\n\nfile content here",
    });
  });

  it("uses default name when attachment has no name", () => {
    const encoded = btoa("data");
    const result = buildContentBlocks("msg", [
      { type: "text", media_type: "text/plain", data: encoded },
    ]);

    expect(result![1]).toEqual({
      type: "text",
      text: "[File: document]\n\ndata",
    });
  });

  it("passes through image attachments as image blocks", () => {
    const result = buildContentBlocks("", [
      { type: "image", media_type: "image/png", data: "base64data" },
    ]);

    expect(result).toHaveLength(1);
    expect(result![0]).toEqual({
      type: "image",
      media_type: "image/png",
      data: "base64data",
    });
  });

  it("omits leading text block when trimmed message is empty", () => {
    const encoded = btoa("contents");
    const result = buildContentBlocks("", [
      { type: "text", media_type: "text/plain", data: encoded },
    ]);

    expect(result).toHaveLength(1);
    expect(result![0].type).toBe("text");
  });

  it("handles multiple mixed attachments", () => {
    const encoded = btoa("hello");
    const result = buildContentBlocks("msg", [
      { type: "text", media_type: "text/plain", data: encoded, name: "a.txt" },
      { type: "image", media_type: "image/jpeg", data: "imgdata" },
    ]);

    expect(result).toHaveLength(3);
    expect(result![0]).toEqual({ type: "text", text: "msg" });
    expect(result![1].type).toBe("text");
    expect(result![2]).toEqual({ type: "image", media_type: "image/jpeg", data: "imgdata" });
  });

  it("returns empty string for invalid base64 in text attachment", () => {
    const result = buildContentBlocks("hi", [
      { type: "text", media_type: "text/plain", data: "%%%not-base64%%%" },
    ]);

    expect(result).toHaveLength(2);
    expect(result![1]).toEqual({
      type: "text",
      text: "[File: document]\n\n",
    });
  });
});

describe("buildAttachmentLabel", () => {
  it("returns empty string for undefined attachments", () => {
    expect(buildAttachmentLabel(undefined)).toBe("");
  });

  it("returns empty string for empty attachments", () => {
    expect(buildAttachmentLabel([])).toBe("");
  });

  it("returns file label when any attachment is text type", () => {
    const result = buildAttachmentLabel([
      { type: "text", media_type: "text/plain", data: "" },
    ]);
    expect(result).toBe("[1 file(s)]");
  });

  it("returns image label when all attachments are image type", () => {
    const result = buildAttachmentLabel([
      { type: "image", media_type: "image/png", data: "" },
      { type: "image", media_type: "image/jpeg", data: "" },
    ]);
    expect(result).toBe("[2 image(s)]");
  });

  it("returns file label for mixed types (text takes precedence)", () => {
    const result = buildAttachmentLabel([
      { type: "image", media_type: "image/png", data: "" },
      { type: "text", media_type: "text/plain", data: "" },
    ]);
    expect(result).toBe("[2 file(s)]");
  });
});
