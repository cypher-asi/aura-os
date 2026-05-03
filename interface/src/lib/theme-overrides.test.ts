import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyOverridesToDocument,
  isValidColorValue,
  loadOverrides,
  saveOverrides,
  type StoredOverrides,
} from "./theme-overrides";

const STORAGE_KEY = "aura-theme-overrides";

describe("theme-overrides", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  describe("loadOverrides / saveOverrides", () => {
    it("returns empty defaults when nothing is stored", () => {
      expect(loadOverrides()).toEqual({ dark: {}, light: {} });
    });

    it("round-trips a saved store", () => {
      const store: StoredOverrides = {
        dark: { "--color-border": "#ff00ff" },
        light: { "--color-sidebar-bg": "#ffffff" },
      };
      saveOverrides(store);
      expect(loadOverrides()).toEqual(store);
    });

    it("falls back to empty defaults when JSON is malformed", () => {
      localStorage.setItem(STORAGE_KEY, "{not json");
      expect(loadOverrides()).toEqual({ dark: {}, light: {} });
    });

    it("drops unknown tokens and non-string values on load", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          dark: {
            "--color-border": "#123456",
            "--not-editable": "#ffffff",
            "--color-sidebar-bg": 42,
          },
          light: null,
        }),
      );
      expect(loadOverrides()).toEqual({
        dark: { "--color-border": "#123456" },
        light: {},
      });
    });

    it("treats a top-level non-object payload as empty", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(["not", "a", "store"]));
      expect(loadOverrides()).toEqual({ dark: {}, light: {} });
    });
  });

  describe("applyOverridesToDocument", () => {
    it("sets present properties and removes absent ones", () => {
      applyOverridesToDocument("dark", {
        "--color-border": "#abcdef",
        "--color-sidebar-bg": "rgb(10, 20, 30)",
      });
      const style = document.documentElement.style;
      expect(style.getPropertyValue("--color-border")).toBe("#abcdef");
      expect(style.getPropertyValue("--color-sidebar-bg")).toBe(
        "rgb(10, 20, 30)",
      );
      expect(style.getPropertyValue("--color-sidekick-bg")).toBe("");
    });

    it("removes previously-set properties when re-applied with a smaller set", () => {
      applyOverridesToDocument("dark", {
        "--color-border": "#111111",
        "--color-sidebar-bg": "#222222",
      });
      expect(
        document.documentElement.style.getPropertyValue("--color-border"),
      ).toBe("#111111");

      applyOverridesToDocument("dark", { "--color-sidebar-bg": "#333333" });
      expect(
        document.documentElement.style.getPropertyValue("--color-border"),
      ).toBe("");
      expect(
        document.documentElement.style.getPropertyValue("--color-sidebar-bg"),
      ).toBe("#333333");
    });

    it("ignores empty-string override values (treated as reset)", () => {
      document.documentElement.style.setProperty("--color-border", "#0f0f0f");
      applyOverridesToDocument("dark", { "--color-border": "" });
      expect(
        document.documentElement.style.getPropertyValue("--color-border"),
      ).toBe("");
    });
  });

  describe("isValidColorValue", () => {
    it.each([
      "#fff",
      "#ffff",
      "#ffffff",
      "#ffffffff",
      "#AbCdEf",
      "rgb(10, 20, 30)",
      "rgba(10, 20, 30, 0.5)",
      "hsl(200, 50%, 50%)",
      "hsla(200, 50%, 50%, 0.4)",
      "red",
      "rebeccapurple",
    ])("accepts %s", (value) => {
      expect(isValidColorValue(value)).toBe(true);
    });

    it.each(["", "   ", "not-a-color-123", "#gggggg", "rgb()", "rgb(;)", "#12"])(
      "rejects %s",
      (value) => {
        expect(isValidColorValue(value)).toBe(false);
      },
    );
  });
});
