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
import { createClient, AnamEvent } from "@anam-ai/js-sdk";
import type { AnamClient } from "@anam-ai/js-sdk";
import { useAgentAvatarStore } from "../../stores/agent-avatar-store";
import { fetchSessionToken } from "../../hooks/anam";
import type { AnamAvatarConfig } from "../../hooks/anam";
import styles from "./AvatarWindow.module.css";

const ANAM_API_KEY = import.meta.env.VITE_ANAM_API_KEY ?? "";
const DEFAULT_CONFIG_KEY = "__avatar_window_default";

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
}

export function AvatarWindow({ isOpen, onClose }: AvatarWindowProps) {
  const [status, setStatus] = useState("idle");
  const [showSettings, setShowSettings] = useState(false);
  const [userStarted, setUserStarted] = useState(false);
  const clientRef = useRef<AnamClient | null>(null);
  const initRef = useRef(false);

  const config = useAgentAvatarStore(
    (s) => s.configs[DEFAULT_CONFIG_KEY] ?? null,
  );

  const videoId = "anam-avatar-window-video";

  // Connect to Anam when user clicks Start
  useEffect(() => {
    if (!isOpen || !userStarted || !config || !ANAM_API_KEY || initRef.current)
      return;
    initRef.current = true;

    const connect = async () => {
      try {
        setStatus("connecting");

        const sessionToken = await fetchSessionToken(config);
        const client = createClient(sessionToken);
        clientRef.current = client;

        client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () =>
          setStatus("streaming"),
        );
        client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
          setStatus("stopped");
          clientRef.current = null;
          initRef.current = false;
        });

        // Brief delay to ensure video element is painted
        await new Promise((r) => setTimeout(r, 200));

        await client.streamToVideoElement(videoId);
        setStatus("ready");
      } catch (err) {
        console.error("[anam] connect failed:", err);
        setStatus("error");
        initRef.current = false;
      }
    };

    void connect();

    return () => {
      clientRef.current?.stopStreaming();
      clientRef.current = null;
      initRef.current = false;
    };
  }, [isOpen, userStarted, config]);

  const handleClose = useCallback(() => {
    clientRef.current?.stopStreaming();
    clientRef.current = null;
    initRef.current = false;
    setUserStarted(false);
    setStatus("idle");
    onClose();
  }, [onClose]);

  const handleStart = useCallback(() => {
    setUserStarted(true);
  }, []);

  if (!isOpen) return null;

  const hasConfig = !!config;
  const needsSetup = !hasConfig && !showSettings;

  return (
    <div className={styles.window}>
      <div className={styles.titleBar}>
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

      <div className={styles.statusBar}>{status}</div>

      {showSettings && (
        <AvatarSettings
          configKey={DEFAULT_CONFIG_KEY}
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
