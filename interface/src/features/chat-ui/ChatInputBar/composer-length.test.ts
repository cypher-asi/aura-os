import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_PROMPT_CHARACTERS,
  promptCharactersOverLimit,
  promptLengthError,
} from "./composer-length";

describe("composer length guard", () => {
  it("allows prompts at the limit", () => {
    const prompt = "a".repeat(MAX_CHAT_PROMPT_CHARACTERS);
    expect(promptCharactersOverLimit(prompt)).toBe(0);
    expect(promptLengthError(prompt)).toBeNull();
  });

  it("reports exactly how many characters must be removed", () => {
    const prompt = "a".repeat(MAX_CHAT_PROMPT_CHARACTERS + 1_234);
    expect(promptCharactersOverLimit(prompt)).toBe(1_234);
    expect(promptLengthError(prompt)).toBe(
      "Remove 1,234 characters to send this message.",
    );
  });

  it("uses the singular label for one extra character", () => {
    const prompt = "a".repeat(MAX_CHAT_PROMPT_CHARACTERS + 1);
    expect(promptLengthError(prompt)).toBe(
      "Remove 1 character to send this message.",
    );
  });
});
