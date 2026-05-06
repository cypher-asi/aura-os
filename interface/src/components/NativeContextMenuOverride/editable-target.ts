/**
 * Detects whether a DOM event target is an editable text field, plus a
 * handful of small clipboard / selection helpers used by the
 * `NativeContextMenuOverride` editable-field menu.
 *
 * The detection is intentionally narrow:
 *   - `<input>` only when the `type` is text-like (text/search/email/url/tel/
 *     password/number, or unset/empty). Buttons, checkboxes, radios, file
 *     pickers, color pickers, etc. are NOT editable for our purposes — we
 *     do not want to show a Cut/Copy/Paste menu when the user right-clicks
 *     a checkbox.
 *   - `<textarea>` is always editable.
 *   - Any element whose closest ancestor (or self) has
 *     `contenteditable="true"` (or `contenteditable=""`, which HTML treats
 *     as `true`) is contentEditable. We deliberately do NOT match
 *     `contenteditable="false"`, which is the explicit opt-out.
 *
 * All clipboard mutations use `document.execCommand` against the focused
 * field. That dispatches the same `cut`/`copy`/`paste` events React's
 * controlled inputs already listen for, so the value the React component
 * holds stays in sync without any extra plumbing. `navigator.clipboard.
 * readText` is preferred for paste because it doesn't require a real
 * `paste` event, but we fall back to `execCommand` when the async API is
 * unavailable (older WebKitGTK builds, non-secure contexts).
 */

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "",
]);

export type EditableTarget =
  | { kind: "input"; el: HTMLInputElement }
  | { kind: "textarea"; el: HTMLTextAreaElement }
  | { kind: "contentEditable"; el: HTMLElement };

export interface EditableTargetState {
  hasSelection: boolean;
  isReadonly: boolean;
}

function isHTMLElement(value: EventTarget | null): value is HTMLElement {
  return value instanceof HTMLElement;
}

function isTextLikeInput(el: HTMLInputElement): boolean {
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  return TEXT_INPUT_TYPES.has(type);
}

export function getEditableTarget(target: EventTarget | null): EditableTarget | null {
  if (!isHTMLElement(target)) return null;

  if (target instanceof HTMLTextAreaElement) {
    return { kind: "textarea", el: target };
  }
  if (target instanceof HTMLInputElement && isTextLikeInput(target)) {
    return { kind: "input", el: target };
  }

  // contenteditable="false" is an explicit opt-out, but `closest` would
  // still match an outer `contenteditable="true"` ancestor — that's the
  // standard browser behaviour (the inner false subtree is non-editable
  // even though it's nested in an editable region). For the menu we care
  // about whether the actual click target sits inside an editable region,
  // so we simply walk up looking for a true ancestor.
  const editableAncestor = target.closest<HTMLElement>(
    '[contenteditable=""], [contenteditable="true"]',
  );
  if (editableAncestor) {
    return { kind: "contentEditable", el: editableAncestor };
  }

  return null;
}

export function getEditableTargetState(target: EditableTarget): EditableTargetState {
  if (target.kind === "input" || target.kind === "textarea") {
    const start = target.el.selectionStart ?? 0;
    const end = target.el.selectionEnd ?? 0;
    return {
      hasSelection: start !== end,
      isReadonly: target.el.readOnly || target.el.disabled,
    };
  }

  // contenteditable: use the document's selection. We only count it as a
  // selection if its anchor lives inside the editable element so a
  // selection in some other field doesn't confuse our menu state.
  const selection = typeof window === "undefined" ? null : window.getSelection();
  const anchorNode = selection?.anchorNode ?? null;
  const insideTarget =
    anchorNode != null && target.el.contains(anchorNode);
  const hasSelection = Boolean(
    insideTarget && selection && !selection.isCollapsed && selection.toString().length > 0,
  );
  return {
    hasSelection,
    isReadonly: target.el.getAttribute("contenteditable") === "false",
  };
}

function focusEditable(target: EditableTarget): void {
  // execCommand acts on the active element. If the right-click didn't
  // already shift focus there (some controls swallow mousedown), do it
  // ourselves so cut/copy/paste/selectAll actually target this field.
  if (document.activeElement !== target.el) {
    try {
      target.el.focus({ preventScroll: true });
    } catch {
      // older WebKit builds reject the options bag; fall back to focus().
      target.el.focus();
    }
  }
}

export function copyFromTarget(target: EditableTarget): boolean {
  focusEditable(target);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

export function cutFromTarget(target: EditableTarget): boolean {
  if (getEditableTargetState(target).isReadonly) return false;
  focusEditable(target);
  try {
    return document.execCommand("cut");
  } catch {
    return false;
  }
}

export function selectAllInTarget(target: EditableTarget): void {
  focusEditable(target);
  if (target.kind === "input" || target.kind === "textarea") {
    try {
      target.el.select();
      return;
    } catch {
      // fall through to execCommand below
    }
  }
  try {
    document.execCommand("selectAll");
  } catch {
    // best-effort; nothing else to do
  }
}

/**
 * Replace the current selection (or insert at the caret) with `text`. For
 * inputs / textareas we splice the value directly so React controlled
 * components see a value change — programmatic value writes don't dispatch
 * `input`, so we follow up with a synthesized `input` event the same way
 * React's own SyntheticEvent layer does.
 */
function insertTextIntoTarget(target: EditableTarget, text: string): void {
  if (target.kind === "input" || target.kind === "textarea") {
    const el = target.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = before + text + after;
    const caret = start + text.length;
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      // ignore — number inputs throw on setSelectionRange in some browsers
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  // contentEditable
  try {
    document.execCommand("insertText", false, text);
  } catch {
    // best-effort
  }
}

export async function pasteIntoTarget(target: EditableTarget): Promise<boolean> {
  if (getEditableTargetState(target).isReadonly) return false;
  focusEditable(target);
  // Prefer the async clipboard API: it works without a real paste event
  // and gives us the text we can splice into controlled inputs. Fall back
  // to execCommand("paste") only when the async API is unavailable,
  // mirroring the strategy in shared/utils/clipboard.ts.
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (typeof text === "string" && text.length > 0) {
        insertTextIntoTarget(target, text);
        return true;
      }
      // Empty clipboard reads aren't an error — surface as success so the
      // menu still closes without flashing an error state.
      return true;
    } catch {
      // permission denied / not supported — fall through.
    }
  }
  try {
    return document.execCommand("paste");
  } catch {
    return false;
  }
}
