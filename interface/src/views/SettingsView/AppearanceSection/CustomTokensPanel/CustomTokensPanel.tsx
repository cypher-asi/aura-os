import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { Button, Text, type ResolvedTheme } from "@cypher-asi/zui";
import { useThemeOverrides } from "../../../../hooks/use-theme-overrides";
import {
  EDITABLE_TOKENS,
  isValidColorValue,
  type EditableToken,
} from "../../../../lib/theme-overrides";
import styles from "./CustomTokensPanel.module.css";

const TOKEN_LABELS: Record<EditableToken, string> = {
  "--color-border": "Border",
  "--color-border-main-panel": "Main panel border",
  "--color-border-chrome": "Topbar / taskbar border",
  "--color-surface-tint": "Surface tint",
  "--color-elevated-tint": "Elevated tint",
  "--color-sidebar-bg": "Sidebar background",
  "--color-sidekick-bg": "Sidekick background",
  "--color-titlebar-bg": "Titlebar background",
  "--color-accent": "Accent",
  "--color-modal-bg": "Modal background",
  "--color-icon-selected": "Selected icon",
};

/**
 * Tokens that render as a paired (dark, light) editor instead of a single
 * row scoped to the active theme. Modal background is per-mode by request:
 * users wanted to dial in jet-black for dark while keeping a light value
 * visible without flipping themes.
 */
const PAIRED_TOKENS: ReadonlySet<EditableToken> = new Set<EditableToken>([
  "--color-modal-bg",
]);

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
  /**
   * Aria/label suffix applied to all inputs and the reset button (e.g.
   * "Border", "Modal background (Dark)"). Defaults to {@link label}.
   */
  controlLabel?: string;
  /**
   * DOM id suffix used to disambiguate the text input when multiple rows
   * share the same token (e.g. the dark/light pair for modal background).
   */
  rowKey?: string;
  currentValue: string | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
};

function TokenRow({
  token,
  label,
  controlLabel,
  rowKey,
  currentValue,
  onChange,
  disabled = false,
}: TokenRowProps) {
  const { draft, isInvalid, handleTextChange, handleColorChange, handleReset } =
    useTokenRowState(currentValue, onChange);
  const ariaLabel = controlLabel ?? label;
  const inputId = `token-text-${token}${rowKey ? `-${rowKey}` : ""}`;
  const swatchTestId = `token-swatch-${token}${rowKey ? `-${rowKey}` : ""}`;
  const hasOverride = typeof currentValue === "string";
  const swatchStyle = useMemo(
    () => ({ background: hasOverride ? currentValue : `var(${token})` }),
    [hasOverride, currentValue, token],
  );
  const textInputClass = `${styles.textInput}${isInvalid ? ` ${styles.textInputInvalid}` : ""}`;

  return (
    <div className={styles.row}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <div className={styles.controls}>
        <span
          aria-hidden="true"
          className={styles.swatch}
          style={swatchStyle}
          data-testid={swatchTestId}
        />
        <input
          type="color"
          aria-label={`${ariaLabel} color picker`}
          value={toColorInputValue(currentValue)}
          onChange={handleColorChange}
          className={styles.colorInput}
          disabled={disabled}
        />
        <input
          id={inputId}
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder={`var(${token})`}
          aria-label={`${ariaLabel} CSS value`}
          aria-invalid={isInvalid || undefined}
          value={draft}
          onChange={handleTextChange}
          className={textInputClass}
          disabled={disabled}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={handleReset}
          aria-label={`Reset ${ariaLabel}`}
          disabled={disabled}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

type PairedTokenRowProps = {
  token: EditableToken;
  label: string;
  darkValue: string | undefined;
  lightValue: string | undefined;
  onChange: (value: string | null, mode: ResolvedTheme) => void;
  disabled?: boolean;
};

/**
 * Two-row editor (dark + light) for tokens whose value is meaningfully
 * different per resolved theme and that the user wants to dial in without
 * having to flip themes. Each row writes through {@link onChange} with an
 * explicit `mode` so the hook can route to the correct working-set entry.
 */
function PairedTokenRow({
  token,
  label,
  darkValue,
  lightValue,
  onChange,
  disabled = false,
}: PairedTokenRowProps) {
  return (
    <div className={styles.pairedGroup} data-testid={`token-pair-${token}`}>
      <Text variant="muted" size="xs" className={styles.pairedHeading}>
        {label}
      </Text>
      <TokenRow
        token={token}
        label="Dark"
        controlLabel={`${label} (Dark)`}
        rowKey="dark"
        currentValue={darkValue}
        onChange={(value) => onChange(value, "dark")}
        disabled={disabled}
      />
      <TokenRow
        token={token}
        label="Light"
        controlLabel={`${label} (Light)`}
        rowKey="light"
        currentValue={lightValue}
        onChange={(value) => onChange(value, "light")}
        disabled={disabled}
      />
    </div>
  );
}

export function CustomTokensPanel() {
  const {
    overrides,
    darkOverrides,
    lightOverrides,
    setToken,
    resetAll,
    presets,
    activePresetId,
  } = useThemeOverrides();
  const activePreset = activePresetId
    ? (presets.find((p) => p.id === activePresetId) ?? null)
    : null;
  const readOnly = activePreset?.readOnly === true;
  const editingPreset = activePreset !== null && !readOnly;

  const rootClass = readOnly
    ? `${styles.root} ${styles.rootDisabled}`
    : styles.root;

  return (
    <div className={rootClass} data-testid="custom-tokens-panel">
      <Text weight="semibold" size="sm">
        Custom colors
      </Text>
      <Text variant="muted" size="xs">
        Customize chrome colors for the current theme. Changes are local to your
        browser.
      </Text>

      {editingPreset && activePreset && (
        <Text size="xs" data-testid="custom-tokens-preset-note">
          Editing preset: {activePreset.name}
        </Text>
      )}
      {readOnly && activePreset && (
        <Text
          size="xs"
          variant="muted"
          data-testid="custom-tokens-readonly-note"
        >
          {activePreset.name} is read-only. Click &ldquo;Save as preset&rdquo;
          above to start customizing.
        </Text>
      )}

      <div className={styles.rows}>
        {EDITABLE_TOKENS.filter((token) => !PAIRED_TOKENS.has(token)).map(
          (token) => (
            <TokenRow
              key={token}
              token={token}
              label={TOKEN_LABELS[token]}
              currentValue={overrides[token]}
              onChange={(value) => setToken(token, value)}
              disabled={readOnly}
            />
          ),
        )}
        {EDITABLE_TOKENS.filter((token) => PAIRED_TOKENS.has(token)).map(
          (token) => (
            <PairedTokenRow
              key={token}
              token={token}
              label={TOKEN_LABELS[token]}
              darkValue={darkOverrides[token]}
              lightValue={lightOverrides[token]}
              onChange={(value, mode) => setToken(token, value, mode)}
              disabled={readOnly}
            />
          ),
        )}
      </div>

      <div className={styles.footer}>
        <Button
          size="sm"
          variant="ghost"
          onClick={resetAll}
          disabled={readOnly}
        >
          Reset all
        </Button>
      </div>
    </div>
  );
}
