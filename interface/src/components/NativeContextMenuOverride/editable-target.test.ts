import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyFromTarget,
  cutFromTarget,
  getEditableTarget,
  getEditableTargetState,
  pasteIntoTarget,
  selectAllInTarget,
} from "./editable-target";

// JSDOM 26+ ships without document.execCommand. The production code is
// already defensive (wraps every call in try/catch), but the tests want
// to spy on it, so we install a no-op stub once and restore it after.
function installExecCommandStub(): { restore: () => void } {
  const proto = Document.prototype as unknown as {
    execCommand?: (...args: unknown[]) => boolean;
  };
  const had = "execCommand" in proto;
  const previous = proto.execCommand;
  proto.execCommand = () => true;
  return {
    restore() {
      if (had) {
        proto.execCommand = previous;
      } else {
        delete proto.execCommand;
      }
    },
  };
}

function createInput(type: string | null = "text"): HTMLInputElement {
  const el = document.createElement("input");
  if (type === null) {
    el.removeAttribute("type");
  } else {
    el.type = type;
  }
  document.body.appendChild(el);
  return el;
}

function createTextarea(): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  document.body.appendChild(el);
  return el;
}

function createContentEditable(value: '"true"' | '""' | '"false"' = '"true"') {
  const div = document.createElement("div");
  div.setAttribute("contenteditable", value.replace(/"/g, ""));
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getEditableTarget", () => {
  it("returns null for non-editable elements", () => {
    const div = document.createElement("div");
    expect(getEditableTarget(div)).toBeNull();
  });

  it("recognises text-like inputs", () => {
    for (const type of ["text", "search", "email", "url", "tel", "password", "number"]) {
      const el = createInput(type);
      expect(getEditableTarget(el)).toEqual({ kind: "input", el });
    }
  });

  it("recognises an input with no type attribute (defaults to text)", () => {
    const el = createInput(null);
    expect(getEditableTarget(el)).toEqual({ kind: "input", el });
  });

  it("ignores non-text inputs", () => {
    for (const type of ["checkbox", "radio", "file", "color", "range", "submit"]) {
      const el = createInput(type);
      expect(getEditableTarget(el)).toBeNull();
    }
  });

  it("recognises textareas", () => {
    const el = createTextarea();
    expect(getEditableTarget(el)).toEqual({ kind: "textarea", el });
  });

  it("walks up to a contenteditable ancestor", () => {
    const editor = createContentEditable('"true"');
    const inner = document.createElement("span");
    inner.textContent = "hi";
    editor.appendChild(inner);
    expect(getEditableTarget(inner)).toEqual({ kind: "contentEditable", el: editor });
  });

  it("matches contenteditable=\"\" (HTML empty-string == true)", () => {
    const editor = createContentEditable('""');
    expect(getEditableTarget(editor)).toEqual({ kind: "contentEditable", el: editor });
  });

  it("does NOT match a bare contenteditable=\"false\" element", () => {
    const editor = createContentEditable('"false"');
    expect(getEditableTarget(editor)).toBeNull();
  });

  it("returns null for non-element targets", () => {
    expect(getEditableTarget(null)).toBeNull();
  });
});

describe("getEditableTargetState", () => {
  it("reports no selection on a fresh input", () => {
    const el = createInput();
    el.value = "hello";
    el.setSelectionRange(2, 2);
    expect(getEditableTargetState({ kind: "input", el })).toEqual({
      hasSelection: false,
      isReadonly: false,
    });
  });

  it("reports a selection when start != end", () => {
    const el = createInput();
    el.value = "hello";
    el.setSelectionRange(0, 3);
    expect(getEditableTargetState({ kind: "input", el })).toEqual({
      hasSelection: true,
      isReadonly: false,
    });
  });

  it("flags readonly and disabled inputs as readonly", () => {
    const ro = createInput();
    ro.readOnly = true;
    expect(getEditableTargetState({ kind: "input", el: ro }).isReadonly).toBe(true);

    const dis = createInput();
    dis.disabled = true;
    expect(getEditableTargetState({ kind: "input", el: dis }).isReadonly).toBe(true);
  });

  it("flags contenteditable=\"false\" elements as readonly via attribute", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "false");
    document.body.appendChild(editor);
    // We synthesise the discriminated union directly because
    // getEditableTarget would return null for this one.
    expect(
      getEditableTargetState({ kind: "contentEditable", el: editor }).isReadonly,
    ).toBe(true);
  });
});

describe("clipboard helpers", () => {
  let execSpy: ReturnType<typeof vi.spyOn>;
  let stub: { restore: () => void };

  beforeEach(() => {
    stub = installExecCommandStub();
    execSpy = vi
      .spyOn(document, "execCommand")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    execSpy.mockRestore();
    stub.restore();
  });

  it("copyFromTarget focuses and runs document.execCommand('copy')", () => {
    const el = createInput();
    el.value = "hello";
    el.setSelectionRange(0, 5);
    expect(copyFromTarget({ kind: "input", el })).toBe(true);
    expect(execSpy).toHaveBeenCalledWith("copy");
    expect(document.activeElement).toBe(el);
  });

  it("cutFromTarget refuses when the field is readonly", () => {
    const el = createInput();
    el.readOnly = true;
    expect(cutFromTarget({ kind: "input", el })).toBe(false);
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("cutFromTarget runs execCommand('cut') for editable fields", () => {
    const el = createInput();
    el.value = "hello";
    el.setSelectionRange(0, 5);
    expect(cutFromTarget({ kind: "input", el })).toBe(true);
    expect(execSpy).toHaveBeenCalledWith("cut");
  });

  it("selectAllInTarget calls input.select() for inputs", () => {
    const el = createInput();
    el.value = "hello world";
    const selectSpy = vi.spyOn(el, "select");
    selectAllInTarget({ kind: "input", el });
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("selectAllInTarget falls back to execCommand for contentEditable", () => {
    const editor = createContentEditable('"true"');
    selectAllInTarget({ kind: "contentEditable", el: editor });
    expect(execSpy).toHaveBeenCalledWith("selectAll");
  });
});

describe("pasteIntoTarget", () => {
  let execSpy: ReturnType<typeof vi.spyOn>;
  let stub: { restore: () => void };

  beforeEach(() => {
    stub = installExecCommandStub();
    execSpy = vi
      .spyOn(document, "execCommand")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    execSpy.mockRestore();
    stub.restore();
    // Tests below replace navigator.clipboard; reset between runs so the
    // next test starts from a known shape.
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it("returns false when the target is readonly", async () => {
    const el = createInput();
    el.readOnly = true;
    expect(await pasteIntoTarget({ kind: "input", el })).toBe(false);
  });

  it("splices clipboard text into a controlled input and dispatches input", async () => {
    const readText = vi.fn().mockResolvedValue("WORLD");
    Object.defineProperty(navigator, "clipboard", {
      value: { readText },
      writable: true,
      configurable: true,
    });
    const el = createInput();
    el.value = "hello, ";
    el.setSelectionRange(7, 7);
    const inputs: string[] = [];
    el.addEventListener("input", () => inputs.push(el.value));

    const ok = await pasteIntoTarget({ kind: "input", el });

    expect(ok).toBe(true);
    expect(readText).toHaveBeenCalledTimes(1);
    expect(el.value).toBe("hello, WORLD");
    expect(inputs).toEqual(["hello, WORLD"]);
    // Caret should land just after the inserted text.
    expect(el.selectionStart).toBe("hello, WORLD".length);
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("falls back to execCommand('paste') when the async clipboard API is missing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const el = createInput();
    el.value = "x";
    el.setSelectionRange(1, 1);
    const ok = await pasteIntoTarget({ kind: "input", el });
    expect(ok).toBe(true);
    expect(execSpy).toHaveBeenCalledWith("paste");
  });

  it("falls back to execCommand('paste') when readText rejects (permission denied)", async () => {
    const readText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { readText },
      writable: true,
      configurable: true,
    });
    const el = createInput();
    const ok = await pasteIntoTarget({ kind: "input", el });
    expect(ok).toBe(true);
    expect(execSpy).toHaveBeenCalledWith("paste");
  });
});
