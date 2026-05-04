import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getZoomLevel, initZoom, resetZoom, zoomIn, zoomOut } from "./zoom";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.style.zoom = "";
  resetZoom();
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.style.zoom = "";
});

describe("zoom helpers", () => {
  it("starts at 1.0", () => {
    expect(getZoomLevel()).toBe(1);
  });

  it("zoomIn raises level by step", () => {
    const before = getZoomLevel();
    const next = zoomIn();
    expect(next).toBeGreaterThan(before);
    expect(document.documentElement.style.zoom).not.toBe("");
  });

  it("zoomOut lowers level by step", () => {
    const next = zoomOut();
    expect(next).toBeLessThan(1);
  });

  it("resetZoom clears applied style and persisted value", () => {
    zoomIn();
    expect(window.localStorage.getItem("aura.zoom.level")).not.toBeNull();
    resetZoom();
    expect(getZoomLevel()).toBe(1);
    expect(document.documentElement.style.zoom).toBe("");
    expect(window.localStorage.getItem("aura.zoom.level")).toBeNull();
  });

  it("clamps to a maximum and minimum", () => {
    for (let i = 0; i < 50; i += 1) zoomIn();
    expect(getZoomLevel()).toBeLessThanOrEqual(2.5);
    for (let i = 0; i < 50; i += 1) zoomOut();
    expect(getZoomLevel()).toBeGreaterThanOrEqual(0.5);
  });

  it("initZoom restores persisted level", () => {
    window.localStorage.setItem("aura.zoom.level", "1.3");
    initZoom();
    expect(getZoomLevel()).toBeCloseTo(1.3, 5);
  });
});
