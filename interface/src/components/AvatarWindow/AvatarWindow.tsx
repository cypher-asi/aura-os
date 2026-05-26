/**
 * Standalone floating avatar window.
 *
 * A self-contained panel that renders an Anam AI video avatar with
 * built-in avatar/voice selection. Designed to float on top of the
 * app — toggleable via any button that calls `onClose`.
 *
 * No modifications to ChatPanel, AgentEditor, or any existing
 * component are required. The only integration point is mounting
 * this component and passing `isOpen` / `onClose`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Settings, X } from "lucide-react";
import { useAgentAvatarStore } from "../../stores/agent-avatar-store";
import { useAnamAvatar, useAnamStreamBridge } from "../../hooks/anam";
import styles from "./AvatarWindow.module.css";

const ANAM_API_KEY = import.meta.env.VITE_ANAM_API_KEY ?? "";

interface AnamApiAvatar {
  id: string;
  displayName: string;
  variantName: string;
  imageUrl: string;
}

interface AnamApiVoice {
  id: string;
  displayName: string;
}

interface AvatarWindowProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  streamKey: string;
}

const ANAM_AVATAR_OPTIONS = { disableBuiltInLlm: true } as const;

export function AvatarWindow({ isOpen, onClose, agentId, streamKey }: AvatarWindowProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [userStarted, setUserStarted] = useState(false);
  const [position, setPosition] = useState({ x: -1, y: 60 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    winX: number;
    winY: number;
  } | null>(null);
  const dragListenersRef = useRef(false);

  const config = useAgentAvatarStore(
    (s) => s.configs[agentId] ?? null,
  );

  const avatar = useAnamAvatar(config, ANAM_AVATAR_OPTIONS);
  useAnamStreamBridge(streamKey, avatar);

  const videoId = "anam-avatar-window-video";

  // Start the avatar session once the video element is rendered
  useEffect(() => {
    if (!isOpen || !userStarted || !config || avatar.status !== "idle") return;
    // Brief delay to ensure the video element is painted
    const timer = setTimeout(() => avatar.start(videoId), 200);
    return () => clearTimeout(timer);
  }, [isOpen, userStarted, config, avatar.status, avatar.start]);

  // ── Drag handlers ──────────────────────────────────────────
  const handleDragMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setPosition({ x: d.winX + dx, y: Math.max(0, d.winY + dy) });
  }, []);

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
    if (dragListenersRef.current) {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      dragListenersRef.current = false;
    }
  }, [handleDragMove]);

  const handleTitleBarPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        winX: position.x === -1 ? window.innerWidth - 320 - 16 : position.x,
        winY: position.y,
      };
      if (!dragListenersRef.current) {
        window.addEventListener("pointermove", handleDragMove);
        window.addEventListener("pointerup", handleDragEnd);
        dragListenersRef.current = true;
      }
    },
    [position, handleDragMove, handleDragEnd],
  );

  useEffect(() => {
    return () => {
      if (dragListenersRef.current) {
        window.removeEventListener("pointermove", handleDragMove);
        window.removeEventListener("pointerup", handleDragEnd);
        dragListenersRef.current = false;
      }
    };
  }, [handleDragMove, handleDragEnd]);

  const handleClose = useCallback(() => {
    avatar.stop();
    setUserStarted(false);
    onClose();
  }, [avatar.stop, onClose]);

  const handleStart = useCallback(() => {
    setUserStarted(true);
  }, []);

  if (!isOpen) return null;

  const hasConfig = !!config;
  const needsSetup = !hasConfig && !showSettings;

  // x === -1 means "use the default CSS position (right: 16px)"
  const windowStyle: React.CSSProperties =
    position.x === -1
      ? { top: position.y }
      : { top: position.y, left: position.x, right: "auto" };

  return (
    <div className={styles.window} style={windowStyle}>
      <div className={styles.titleBar} onPointerDown={handleTitleBarPointerDown}>
        <span className={styles.titleLabel}>Avatar</span>
        <div className={styles.titleActions}>
          <button
            type="button"
            className={styles.titleButton}
            onClick={() => setShowSettings((s) => !s)}
            aria-label="Avatar settings"
          >
            <Settings size={14} />
          </button>
          <button
            type="button"
            className={styles.titleButton}
            onClick={handleClose}
            aria-label="Close avatar"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className={styles.videoContainer}>
        {!userStarted ? (
          <button
            type="button"
            className={styles.startButton}
            onClick={needsSetup ? () => setShowSettings(true) : handleStart}
            disabled={!hasConfig && !needsSetup}
          >
            {needsSetup ? "Configure avatar to get started" : "Start Avatar"}
          </button>
        ) : (
          <video
            id={videoId}
            autoPlay
            playsInline
            className={styles.video}
          />
        )}
      </div>

      <div className={styles.statusBar}>
        {avatar.error ?? avatar.status}
      </div>

      {showSettings && (
        <AvatarSettings
          configKey={agentId}
          onDone={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

/* ── Inline settings panel ─────────────────────────────────── */

function AvatarSettings({
  configKey,
  onDone,
}: {
  configKey: string;
  onDone: () => void;
}) {
  const [avatars, setAvatars] = useState<AnamApiAvatar[]>([]);
  const [voices, setVoices] = useState<AnamApiVoice[]>([]);
  const [loading, setLoading] = useState(true);

  const currentConfig = useAgentAvatarStore((s) => s.configs[configKey] ?? null);
  const setAvatar = useAgentAvatarStore((s) => s.setAvatar);

  const [selectedAvatarId, setSelectedAvatarId] = useState(
    currentConfig?.avatarId ?? "",
  );
  const [selectedVoiceId, setSelectedVoiceId] = useState(
    currentConfig?.voiceId ?? "",
  );

  useEffect(() => {
    if (!ANAM_API_KEY) {
      setLoading(false);
      return;
    }

    const headers = { Authorization: `Bearer ${ANAM_API_KEY}` };

    Promise.all([
      fetch("https://api.anam.ai/v1/avatars", { headers }).then((r) =>
        r.ok ? r.json() : { data: [] },
      ),
      fetch("https://api.anam.ai/v1/voices", { headers }).then((r) =>
        r.ok ? r.json() : { data: [] },
      ),
    ])
      .then(([avatarRes, voiceRes]) => {
        setAvatars(avatarRes.data as AnamApiAvatar[]);
        setVoices(voiceRes.data as AnamApiVoice[]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(() => {
    if (!selectedAvatarId || !selectedVoiceId) return;
    const avatar = avatars.find((a) => a.id === selectedAvatarId);
    setAvatar(configKey, {
      avatarId: selectedAvatarId,
      voiceId: selectedVoiceId,
      name: avatar?.displayName,
    });
    onDone();
  }, [avatars, configKey, onDone, selectedAvatarId, selectedVoiceId, setAvatar]);

  const handleRemove = useCallback(() => {
    setAvatar(configKey, null);
    setSelectedAvatarId("");
    setSelectedVoiceId("");
  }, [configKey, setAvatar]);

  if (loading) {
    return (
      <div className={styles.settings}>
        <span className={styles.settingsHint}>Loading avatars...</span>
      </div>
    );
  }

  return (
    <div className={styles.settings}>
      <span className={styles.settingsLabel}>Select an avatar</span>

      {currentConfig && (
        <div className={styles.activeConfig}>
          <span>Active: {currentConfig.name ?? "Avatar"}</span>
          <button
            type="button"
            className={styles.removeButton}
            onClick={handleRemove}
          >
            Remove
          </button>
        </div>
      )}

      <div className={styles.avatarGrid}>
        {avatars.map((avatar) => (
          <button
            key={avatar.id}
            type="button"
            className={`${styles.avatarOption} ${
              selectedAvatarId === avatar.id ? styles.avatarOptionSelected : ""
            }`}
            onClick={() => setSelectedAvatarId(avatar.id)}
          >
            <img
              src={avatar.imageUrl}
              alt={avatar.displayName}
              className={styles.avatarThumb}
            />
            <div className={styles.avatarName}>{avatar.displayName}</div>
          </button>
        ))}
      </div>

      {selectedAvatarId && (
        <>
          <span className={styles.settingsHint}>Select a voice</span>
          <select
            value={selectedVoiceId}
            onChange={(e) => setSelectedVoiceId(e.target.value)}
            className={styles.voiceSelect}
          >
            <option value="">Choose a voice...</option>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.displayName}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={styles.saveButton}
            disabled={!selectedVoiceId}
            onClick={handleSave}
          >
            Save
          </button>
        </>
      )}
    </div>
  );
}
