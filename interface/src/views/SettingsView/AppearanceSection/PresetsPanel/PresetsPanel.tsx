import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
import { Button, Text, useTheme } from "@cypher-asi/zui";
import { Check, Copy } from "lucide-react";
import { Select } from "../../../../components/Select/Select";
import { useThemeOverrides } from "../../../../hooks/use-theme-overrides";
import type { ThemePreset } from "../../../../lib/theme-presets";
import {
  readResolvedTokens,
  serializeThemeDocument,
} from "../../../../lib/theme-export";
import styles from "./PresetsPanel.module.css";

type PanelMode =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "renaming"; presetId: string };

type ImportStatus =
  | { kind: "none" }
  | { kind: "error"; reason: string }
  | { kind: "success"; name: string };

type NameFormProps = {
  initialName: string;
  ariaLabel: string;
  onSave: (name: string) => void;
  onCancel: () => void;
};

function NameForm({ initialName, ariaLabel, onSave, onCancel }: NameFormProps) {
  const [draft, setDraft] = useState<string>(initialName);
  const trimmed = draft.trim();
  const handleSubmit = useCallback(() => {
    if (trimmed.length === 0) return;
    onSave(trimmed);
  }, [trimmed, onSave]);

  return (
    <div className={styles.inlineForm}>
      <input
        type="text"
        autoFocus
        aria-label={ariaLabel}
        className={styles.nameInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <Button
        size="sm"
        variant="filled"
        onClick={handleSubmit}
        disabled={trimmed.length === 0}
      >
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

type ActionRowProps = {
  activePreset: ThemePreset | null;
  onSave: () => void;
  onRename: () => void;
  onDelete: () => void;
  onExport: () => void;
  onImport: () => void;
};

function ActionRow({
  activePreset,
  onSave,
  onRename,
  onDelete,
  onExport,
  onImport,
}: ActionRowProps) {
  const editable = activePreset !== null && !activePreset.readOnly;
  return (
    <div className={styles.actions}>
      <Button size="sm" variant="ghost" onClick={onSave}>
        Save as preset
      </Button>
      <Button size="sm" variant="ghost" onClick={onRename} disabled={!editable}>
        Rename
      </Button>
      <Button size="sm" variant="ghost" onClick={onDelete} disabled={!editable}>
        Delete
      </Button>
      <Button size="sm" variant="ghost" onClick={onExport}>
        Export
      </Button>
      <Button size="sm" variant="ghost" onClick={onImport}>
        Import
      </Button>
    </div>
  );
}

function downloadJson(name: string, json: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const slug = name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "preset";
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ImportHandler = (raw: string) => Promise<void>;

function useImportFile(
  inputRef: RefObject<HTMLInputElement | null>,
  onResult: (status: ImportStatus) => void,
  importPreset: ReturnType<typeof useThemeOverrides>["importPreset"],
): { triggerImport: () => void; handleFileChange: ImportHandler } {
  const triggerImport = useCallback(() => {
    onResult({ kind: "none" });
    inputRef.current?.click();
  }, [inputRef, onResult]);

  const handleFileChange = useCallback(
    async (raw: string) => {
      const result = importPreset(raw);
      if (result.ok) {
        onResult({ kind: "success", name: result.preset.name });
      } else {
        onResult({ kind: "error", reason: result.reason });
      }
    },
    [importPreset, onResult],
  );

  return { triggerImport, handleFileChange };
}

export function PresetsPanel() {
  const {
    presets,
    activePresetId,
    overrides,
    selectPreset,
    createPresetFromCurrent,
    renamePreset,
    deletePreset,
    importPreset,
  } = useThemeOverrides();
  const { resolvedTheme } = useTheme();

  const [mode, setMode] = useState<PanelMode>({ kind: "idle" });
  const [importStatus, setImportStatus] = useState<ImportStatus>({
    kind: "none",
  });
  const [copied, setCopied] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activePreset =
    presets.find((p) => p.id === activePresetId) ?? null;

  const themeName = activePreset?.name ?? "Custom";
  const themeJson = useMemo(() => {
    // Resolved defaults come from the live document; the active layer's
    // `overrides` are merged on top so the latest edited values win even if the
    // apply-effect that writes them to the DOM hasn't flushed for this render.
    const tokens = { ...readResolvedTokens(), ...overrides };
    return serializeThemeDocument(themeName, resolvedTheme, tokens);
  }, [themeName, resolvedTheme, overrides]);

  const presetOptions = useMemo(
    () => [
      { value: "", label: "(working set)" },
      ...presets.map((p) => ({
        value: p.id,
        label: `${p.name}${p.readOnly ? " (built-in)" : ""}`,
      })),
    ],
    [presets],
  );

  const onSelectValue = useCallback(
    (value: string) => {
      selectPreset(value === "" ? null : value);
      setMode({ kind: "idle" });
      setImportStatus({ kind: "none" });
    },
    [selectPreset],
  );

  const onSave = useCallback(() => {
    setMode({ kind: "saving" });
    setImportStatus({ kind: "none" });
  }, []);

  const onRename = useCallback(() => {
    if (!activePreset || activePreset.readOnly) return;
    setMode({ kind: "renaming", presetId: activePreset.id });
    setImportStatus({ kind: "none" });
  }, [activePreset]);

  const onDelete = useCallback(() => {
    if (!activePreset || activePreset.readOnly) return;
    if (!window.confirm(`Delete preset "${activePreset.name}"?`)) return;
    deletePreset(activePreset.id);
  }, [activePreset, deletePreset]);

  const onExport = useCallback(() => {
    downloadJson(themeName, themeJson);
  }, [themeName, themeJson]);

  const onCopyJson = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(themeJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [themeJson]);

  const { triggerImport, handleFileChange } = useImportFile(
    fileInputRef,
    setImportStatus,
    importPreset,
  );

  const onFileInputChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const text = await file.text();
      await handleFileChange(text);
    },
    [handleFileChange],
  );

  const cancelMode = useCallback(() => setMode({ kind: "idle" }), []);

  const confirmSave = useCallback(
    (name: string) => {
      createPresetFromCurrent(name);
      setMode({ kind: "idle" });
    },
    [createPresetFromCurrent],
  );

  const confirmRename = useCallback(
    (name: string) => {
      if (mode.kind !== "renaming") return;
      renamePreset(mode.presetId, name);
      setMode({ kind: "idle" });
    },
    [mode, renamePreset],
  );

  return (
    <div className={styles.root} data-testid="presets-panel">
      <Text weight="semibold" size="sm">
        Theme presets
      </Text>
      <Text variant="muted" size="xs">
        Save your custom colors as a preset, or share a JSON file. Built-in
        presets are read-only.
      </Text>

      <div className={styles.controls}>
        <div className={styles.row}>
          <Select
            value={activePresetId ?? ""}
            onChange={onSelectValue}
            options={presetOptions}
            className={styles.select}
          />
        </div>

        {mode.kind === "saving" && (
          <NameForm
            initialName=""
            ariaLabel="New preset name"
            onSave={confirmSave}
            onCancel={cancelMode}
          />
        )}
        {mode.kind === "renaming" && activePreset && (
          <NameForm
            initialName={activePreset.name}
            ariaLabel="Rename preset"
            onSave={confirmRename}
            onCancel={cancelMode}
          />
        )}
        {mode.kind === "idle" && (
          <ActionRow
            activePreset={activePreset}
            onSave={onSave}
            onRename={onRename}
            onDelete={onDelete}
            onExport={onExport}
            onImport={triggerImport}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={onFileInputChange}
          aria-label="Import preset file"
          className={styles.hiddenInput}
          data-testid="preset-import-file"
        />

        {importStatus.kind === "error" && (
          <Text size="xs" className={styles.error}>
            {importStatus.reason}
          </Text>
        )}
        {importStatus.kind === "success" && (
          <Text size="xs" className={styles.successInline}>
            Imported &ldquo;{importStatus.name}&rdquo;.
          </Text>
        )}
      </div>

      <div className={styles.jsonSection} data-testid="theme-json">
        <div className={styles.jsonHeader}>
          <Text variant="muted" size="xs">
            Current theme JSON
          </Text>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCopyJson}
            title="Copy theme JSON"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className={styles.jsonBlock}>{themeJson}</pre>
      </div>
    </div>
  );
}
