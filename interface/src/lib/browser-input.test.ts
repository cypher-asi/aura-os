import { describe, expect, it } from "vitest";
import { toViewportCoords, VK_BY_CODE } from "./browser-input";

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

  it("maps scaled canvas coordinates back to viewport pixels", () => {
    expect(
      toViewportCoords(
        { clientX: 110, clientY: 70 },
        { left: 10, top: 20, width: 200, height: 100 },
        { width: 400, height: 300 },
      ),
    ).toEqual({ x: 200, y: 150 });
  });
});
