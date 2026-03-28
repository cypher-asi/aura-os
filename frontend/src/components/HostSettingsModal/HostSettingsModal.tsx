import { useEffect, useState } from "react";
import { Button, Input, Modal, Spinner, Text } from "@cypher-asi/zui";
import { useShallow } from "zustand/react/shallow";
import { useHostStore } from "../../stores/host-store";
import {
  getHostDisplayLabel,
  getNativeDefaultHostOrigin,
  getResolvedHostOrigin,
  normalizeHostOrigin,
  requiresExplicitHostOrigin,
} from "../../lib/host-config";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import styles from "../SettingsModal/SettingsModal.module.css";

export function HostSettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { hostOrigin, status, setHostOrigin, refreshStatus } = useHostStore(
    useShallow((s) => ({ hostOrigin: s.hostOrigin, status: s.status, setHostOrigin: s.setHostOrigin, refreshStatus: s.refreshStatus })),
  );
  const hostLabel = getHostDisplayLabel();
  const defaultHostOrigin = getNativeDefaultHostOrigin();
  const resolvedOrigin = getResolvedHostOrigin();
  const { isNativeApp } = useAuraCapabilities();
  const nativeHostRequired = isNativeApp && requiresExplicitHostOrigin();
  const [value, setValue] = useState(hostOrigin ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => {
      setValue(hostOrigin ?? "");
      setError("");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hostOrigin, isOpen]);

  const handleSave = async () => {
    const normalized = normalizeHostOrigin(value);
    if (value.trim() && !normalized) {
      setError("Enter a valid host like 192.168.1.20:5173 or https://aura.example.com");
      return;
    }

    setSaving(true);
    setHostOrigin(normalized);
    await refreshStatus();
    window.location.reload();
  };

  const handleUseCurrent = async () => {
    setSaving(true);
    setHostOrigin(null);
    await refreshStatus();
    window.location.reload();
  };

  const handleUseBuildDefault = async () => {
    setSaving(true);
    setHostOrigin(null);
    await refreshStatus();
    window.location.reload();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Host Connection"
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          {!nativeHostRequired ? (
            <Button variant="secondary" onClick={handleUseCurrent} disabled={saving}>
              {saving ? <><Spinner size="sm" /> Applying...</> : "Use Current Origin"}
            </Button>
          ) : defaultHostOrigin ? (
            <Button variant="secondary" onClick={handleUseBuildDefault} disabled={saving}>
              {saving ? <><Spinner size="sm" /> Applying...</> : "Use Build Default"}
            </Button>
          ) : null}
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <><Spinner size="sm" /> Applying...</> : "Save Host"}
          </Button>
        </>
      )}
    >
      <div className={styles.content}>
        <Text variant="muted" size="sm">
          {nativeHostRequired
            ? defaultHostOrigin
              ? "Point Aura at a live host. Native mobile builds can use the build default host or a custom override, but never the embedded app origin for API requests."
              : "Point Aura at a live host. Native mobile builds cannot use the embedded app origin for API requests."
            : "Point Aura at a live host. Leave this blank to use the current origin or dev proxy."}
        </Text>

        <div className={styles.infoGrid}>
          <Text variant="muted" size="sm" as="span">Current target</Text>
          <Text size="sm" as="span" className={styles.monoText}>{hostLabel}</Text>
          <Text variant="muted" size="sm" as="span">Resolved origin</Text>
          <Text size="sm" as="span" className={styles.monoText}>{resolvedOrigin || "—"}</Text>
          <Text variant="muted" size="sm" as="span">Status</Text>
          <Text size="sm" as="span">{status.replace(/_/g, " ")}</Text>
          {defaultHostOrigin ? (
            <>
              <Text variant="muted" size="sm" as="span">Build default</Text>
              <Text size="sm" as="span" className={styles.monoText}>{defaultHostOrigin}</Text>
            </>
          ) : null}
        </div>

        <div>
          <Text variant="muted" size="sm" as="div" className={styles.marginBottomSm}>
            Custom host
          </Text>
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError("");
            }}
            placeholder={nativeHostRequired ? "https://aura.example.com or http://10.0.2.2:3100" : "192.168.1.20:5173"}
            mono
          />
        </div>

        {error && (
          <Text variant="muted" size="sm" className={styles.dangerText}>
            {error}
          </Text>
        )}
      </div>
    </Modal>
  );
}
