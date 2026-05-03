import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { useThemeOverrides } from "../../../../hooks/use-theme-overrides";
import {
  EDITABLE_TOKENS,
  isValidColorValue,
  type EditableToken,
} from "../../../../lib/theme-overrides";
import styles from "./CustomTokensPanel.module.css";

const TOKEN_LABELS: Record<EditableToken, string> = {
  "--color-border": "Border",
  "--color-surface-tint": "Surface tint",
  "--color-elevated-tint": "Elevated tint",
  "--color-sidebar-bg": "Sidebar background",
  "--color-sidekick-bg": "Sidekick background",
  "--color-titlebar-bg": "Titlebar background",
  "--color-accent": "Accent",
};

/**
 * `<input type="color">` only supports `#rrggbb`, so derive a safe
 * starter value whenever the token is unset or the current override is
 * a non-hex CSS color. Fallback is mid-grey — it's only shown in the
 * native picker popover, not on the preview swatch.
 */
function toColorInputValue(value: string | undefined): string {
  if (typeof value !== "string") return "#808080";
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#808080";
}

type RowHandlers = {
  draft: string;
  isInvalid: boolean;
  handleTextChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleColorChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleReset: () => void;
};

function useTokenRowState(
  currentValue: string | undefined,
  onChange: (value: string | null) => void,
): RowHandlers {
  const [draft, setDraft] = useState<string>(currentValue ?? "");
  const [touched, setTouched] = useState<boolean>(false);

  const isInvalid =
    touched && draft.trim().length > 0 && !isValidColorValue(draft);

  const handleTextChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setDraft(next);
      setTouched(true);
      const trimmed = next.trim();
      if (trimmed.length === 0) {
        onChange(null);
      } else if (isValidColorValue(trimmed)) {
        onChange(trimmed);
      } else {
        // Invalid mid-typing value (e.g. "#12", "rgb(" or a previously
        // valid prefix like "not" that later became "not-a-..."): clear
        // the active override so stale values don't linger. The red
        // border (`isInvalid`) communicates the reject.
        onChange(null);
      }
    },
    [onChange],
  );

  const handleColorChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setDraft(next);
      setTouched(true);
      onChange(next);
    },
    [onChange],
  );

  const handleReset = useCallback(() => {
    setDraft("");
    setTouched(false);
    onChange(null);
  }, [onChange]);

  return { draft, isInvalid, handleTextChange, handleColorChange, handleReset };
}

type TokenRowProps = {
  token: EditableToken;
  label: string;
  currentValue: string | undefined;
  onChange: (value: string | null) => void;
};

function TokenRow({ token, label, currentValue, onChange }: TokenRowProps) {
  const { draft, isInvalid, handleTextChange, handleColorChange, handleReset } =
    useTokenRowState(currentValue, onChange);
  const hasOverride = typeof currentValue === "string";
  const swatchStyle = useMemo(
    () => ({ background: hasOverride ? currentValue : `var(${token})` }),
    [hasOverride, currentValue, token],
  );
  const textInputClass = `${styles.textInput}${isInvalid ? ` ${styles.textInputInvalid}` : ""}`;

  return (
    <div className={styles.row}>
      <label className={styles.label} htmlFor={`token-text-${token}`}>
        {label}
      </label>
      <div className={styles.controls}>
        <span
          aria-hidden="true"
          className={styles.swatch}
          style={swatchStyle}
          data-testid={`token-swatch-${token}`}
        />
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={toColorInputValue(currentValue)}
          onChange={handleColorChange}
          className={styles.colorInput}
        />
        <input
          id={`token-text-${token}`}
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder={`var(${token})`}
          aria-label={`${label} CSS value`}
          aria-invalid={isInvalid || undefined}
          value={draft}
          onChange={handleTextChange}
          className={textInputClass}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={handleReset}
          aria-label={`Reset ${label}`}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

export function CustomTokensPanel() {
  const { overrides, setToken, resetAll } = useThemeOverrides();

  return (
    <div className={styles.root} data-testid="custom-tokens-panel">
      <Text weight="semibold" size="sm">
        Custom colors
      </Text>
      <Text variant="muted" size="xs">
        Customize chrome colors for the current theme. Changes are local to your
        browser.
      </Text>

      <div className={styles.rows}>
        {EDITABLE_TOKENS.map((token) => (
          <TokenRow
            key={token}
            token={token}
            label={TOKEN_LABELS[token]}
            currentValue={overrides[token]}
            onChange={(value) => setToken(token, value)}
          />
        ))}
      </div>

      <div className={styles.footer}>
        <Button size="sm" variant="ghost" onClick={resetAll}>
          Reset all
        </Button>
      </div>
    </div>
  );
}
