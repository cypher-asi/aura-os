import { describe, expect, it } from "vitest";
import { parseThemeDocument, serializeThemeDocument } from "./theme-export";

describe("theme-export", () => {
  describe("serializeThemeDocument", () => {
    it("emits a self-describing document with known tokens in EDITABLE order", () => {
      const json = serializeThemeDocument("My Theme", "dark", {
        "--color-accent": "#01a4f4",
        "--color-border": "#27272a",
        // Unknown tokens are dropped.
        ["--bogus" as never]: "#ffffff",
      });
      const parsed = JSON.parse(json);
      expect(parsed.format).toBe("aura-theme");
      expect(parsed.version).toBe(1);
      expect(parsed.name).toBe("My Theme");
      expect(parsed.mode).toBe("dark");
      expect(parsed.tokens["--bogus"]).toBeUndefined();
      // `--color-border` precedes `--color-accent` in EDITABLE_TOKENS.
      expect(Object.keys(parsed.tokens)).toEqual([
        "--color-border",
        "--color-accent",
      ]);
    });
  });

  describe("parseThemeDocument", () => {
    it("parses a valid document and sanitizes tokens", () => {
      const result = parseThemeDocument({
        format: "aura-theme",
        version: 1,
        name: "  Shared  ",
        mode: "light",
        tokens: { "--color-border": "#abcdef", "--nope": "x", bad: 1 },
      });
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Shared");
      expect(result?.mode).toBe("light");
      expect(result?.tokens).toEqual({ "--color-border": "#abcdef" });
    });

    it("returns null for non-aura-theme or invalid payloads", () => {
      expect(
        parseThemeDocument({ name: "x", base: "dark", overrides: {} }),
      ).toBeNull();
      expect(parseThemeDocument(null)).toBeNull();
      expect(
        parseThemeDocument({
          format: "aura-theme",
          version: 1,
          name: "x",
          mode: "neon",
          tokens: {},
        }),
      ).toBeNull();
    });
  });
});
