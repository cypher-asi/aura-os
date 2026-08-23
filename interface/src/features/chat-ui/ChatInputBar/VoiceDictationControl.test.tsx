import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoiceDictationControl } from "./VoiceDictationControl";

describe("VoiceDictationControl", () => {
  it("is absent when the browser has no speech recognition support", () => {
    render(
      <VoiceDictationControl
        supported={false}
        listening={false}
        error={null}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("announces and stops an active dictation session", () => {
    const onToggle = vi.fn();
    render(
      <VoiceDictationControl
        supported
        listening
        error={null}
        onToggle={onToggle}
      />,
    );
    const button = screen.getByRole("button", { name: "Stop voice dictation" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
