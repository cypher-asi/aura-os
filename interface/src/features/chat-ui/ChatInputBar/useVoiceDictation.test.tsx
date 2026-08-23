import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceDictation } from "./useVoiceDictation";

class MockSpeechRecognition {
  static latest: MockSpeechRecognition | null = null;

  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: { results: ArrayLike<unknown> }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    MockSpeechRecognition.latest = this;
  }

  emitTranscript(text: string, isFinal = false) {
    this.onresult?.({
      results: [
        {
          0: { transcript: text },
          length: 1,
          isFinal,
        },
      ],
    });
  }
}

describe("useVoiceDictation", () => {
  beforeEach(() => {
    MockSpeechRecognition.latest = null;
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition,
    });
  });

  afterEach(() => {
    delete window.webkitSpeechRecognition;
  });

  it("adds interim speech to the existing draft without sending", () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceDictation(onTranscript));

    act(() => result.current.start("Existing draft"));
    expect(result.current.supported).toBe(true);
    expect(result.current.listening).toBe(true);
    expect(MockSpeechRecognition.latest?.start).toHaveBeenCalledTimes(1);

    act(() => MockSpeechRecognition.latest?.emitTranscript(" dictated thought"));
    expect(onTranscript).toHaveBeenLastCalledWith("Existing draft dictated thought");

    act(() => result.current.stop());
    expect(MockSpeechRecognition.latest?.stop).toHaveBeenCalledTimes(1);
    expect(result.current.listening).toBe(false);
  });

  it("surfaces a denied microphone permission", () => {
    const { result } = renderHook(() => useVoiceDictation(vi.fn()));
    act(() => result.current.start(""));
    act(() => MockSpeechRecognition.latest?.onerror?.({ error: "not-allowed" }));

    expect(result.current.listening).toBe(false);
    expect(result.current.error).toBe("Microphone permission was denied");
  });
});
