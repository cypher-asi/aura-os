import { describe, expect, it } from "vitest";
import { VK_BY_CODE } from "./browser-input";

describe("browser-input", () => {
  it("includes digit and letter virtual key mappings", () => {
    expect(VK_BY_CODE.Digit0).toBe(0x30);
    expect(VK_BY_CODE.Digit9).toBe(0x39);
    expect(VK_BY_CODE.KeyA).toBe(0x41);
    expect(VK_BY_CODE.KeyZ).toBe(0x5a);
  });

  it("exports a frozen lookup table after initialization", () => {
    expect(Object.isFrozen(VK_BY_CODE)).toBe(true);
  });
});
