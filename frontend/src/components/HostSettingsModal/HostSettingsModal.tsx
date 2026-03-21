import { useEffect, useState } from "react";
import { Button, Input, Modal, Spinner, Text } from "@cypher-asi/zui";
import { useShallow } from "zustand/react/shallow";
import { useHostStore } from "../../stores/host-store";
import { getHostDisplayLabel, getResolvedHostOrigin, normalizeHostOrigin } from "../../lib/host-config";
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
  const resolvedOrigin = getResolvedHostOrigin();
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Host Connection"
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" onClick={handleUseCurrent} disabled={saving}>
            {saving ? <><Spinner size="sm" /> Applying...</> : "Use Current Origin"}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <><Spinner size="sm" /> Applying...</> : "Save Host"}
          </Button>
        </>
      )}
    >
      <div className={styles.content}>
        <Text variant="muted" size="sm">
          Point Aura at a live host. Leave this blank to use the current origin or dev proxy.
        </Text>

        <div className={styles.infoGrid}>
          <Text variant="muted" size="sm" as="span">Current target</Text>
          <Text size="sm" as="span" className={styles.monoText}>{hostLabel}</Text>
          <Text variant="muted" size="sm" as="span">Resolved origin</Text>
          <Text size="sm" as="span" className={styles.monoText}>{resolvedOrigin || "—"}</Text>
          <Text variant="muted" size="sm" as="span">Status</Text>
          <Text size="sm" as="span">{status.replace(/_/g, " ")}</Text>
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
            placeholder="192.168.1.20:5173"
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
