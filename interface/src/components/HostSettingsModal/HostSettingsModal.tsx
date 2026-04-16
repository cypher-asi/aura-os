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
import styles from "./HostSettingsModal.module.css";

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
  const { isNativeApp, isMobileLayout } = useAuraCapabilities();
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

  const secondaryActionLabel = !nativeHostRequired
    ? "Use Current Origin"
    : defaultHostOrigin
      ? "Use Build Default"
      : null;
  const secondaryAction = !nativeHostRequired
    ? handleUseCurrent
    : defaultHostOrigin
      ? handleUseBuildDefault
      : null;
  const mobileFooter = isMobileLayout ? (
    <>
      <Button variant="ghost" onClick={onClose} disabled={saving}>Close</Button>
      <Button variant="primary" onClick={handleSave} disabled={saving}>
        {saving ? <><Spinner size="sm" /> Applying...</> : "Save Host"}
      </Button>
    </>
  ) : (
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
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Host Connection"
      headerActions={isMobileLayout ? <Button variant="ghost" size="sm" onClick={onClose}>Done</Button> : undefined}
      size={isMobileLayout ? "full" : "sm"}
      fullHeight={isMobileLayout}
      className={isMobileLayout ? styles.mobileModal : undefined}
      contentClassName={isMobileLayout ? styles.mobileContent : undefined}
      footer={mobileFooter}
    >
      <div className={isMobileLayout ? styles.mobileStack : styles.content}>
        <Text variant="muted" size="sm">
          {nativeHostRequired
            ? defaultHostOrigin
              ? "Point Aura at a live host. Mobile builds can use the build default host or a custom override."
              : "Point Aura at a live host. Mobile builds cannot use the embedded app origin for API requests."
            : "Point Aura at a live host. Leave this blank to use the current origin or dev proxy."}
        </Text>

        {isMobileLayout ? (
          <>
            <section className={styles.mobileSection}>
              <div className={styles.mobileSectionHeader}>
                <Text size="sm" weight="medium">Current target</Text>
                <Text size="xs" variant="muted">{status.replace(/_/g, " ")}</Text>
              </div>
              <Text size="sm" className={styles.mobileMono}>{hostLabel}</Text>
              {defaultHostOrigin ? (
                <div className={styles.mobileMetaRow}>
                  <Text size="xs" variant="muted">Build default</Text>
                  <Text size="sm" className={styles.mobileMono}>{defaultHostOrigin}</Text>
                </div>
              ) : null}
            </section>

            <section className={styles.mobileSection}>
              <Text size="sm" weight="medium">Custom host</Text>
              <Text size="xs" variant="muted">
                {nativeHostRequired
                  ? "Use a reachable network host such as your dev machine or a hosted Aura environment."
                  : "Use a LAN or hosted Aura address when you need to point this app somewhere else."}
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
              {secondaryActionLabel && secondaryAction ? (
                <Button variant="secondary" onClick={secondaryAction} disabled={saving}>
                  {saving ? <><Spinner size="sm" /> Applying...</> : secondaryActionLabel}
                </Button>
              ) : null}
            </section>
          </>
        ) : (
          <>
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
          </>
        )}

        {error && (
          <Text variant="muted" size="sm" className={styles.dangerText}>
            {error}
          </Text>
        )}
      </div>
    </Modal>
  );
}
