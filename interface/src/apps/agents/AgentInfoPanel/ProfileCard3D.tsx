import { useEffect, useRef, useState } from "react";
import { useTheme } from "@cypher-asi/zui";
import { FollowEditButton } from "../../../components/FollowEditButton";
import type { Agent } from "../../../shared/types";
import { useAvatarState } from "../../../hooks/use-avatar-state";
import { useProfileStatusStore } from "../../../stores/profile-status-store";
import { type AgentSidekickTab } from "../stores/agent-sidekick-store";
import {
  createProfileCardScene,
  type ProfileCardScene,
} from "./profile-card-scene";
import {
  drawInfoStrip,
  drawPersonalityScreen,
  drawProfileCardTexture,
  drawStatusBadge,
  loadCardAvatar,
} from "./profile-card-texture";
import styles from "./AgentInfoPanel.module.css";

/** A navigation link shown in the DOM metal card below the 3D card. */
export interface ProfileSectionLink {
  id: AgentSidekickTab;
  label: string;
  count: number;
}

/** Normalized statuses that should not read as "online". */
const OFFLINE_STATUSES = new Set([
  "stopped",
  "stopping",
  "hibernating",
  "error",
  "archived",
  "offline",
]);

/**
 * Remote VM states that count as "online" (the dot glows). Only an actively
 * running VM is online; `idle`, `hibernating`, etc. are not. Note
 * `useAvatarState` normalizes `working` -> `running`.
 */
const REMOTE_ONLINE_STATES = new Set(["running"]);

/** Human-readable labels for the remote VM states (see VmStatusBadge). */
const REMOTE_STATE_LABELS: Record<string, string> = {
  running: "Running",
  idle: "Idle",
  provisioning: "Provisioning",
  hibernating: "Hibernating",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
};

function readAccent(el: HTMLElement): string {
  const value = getComputedStyle(el).getPropertyValue("--color-accent").trim();
  return value || "#6366f1";
}

function readLineColor(el: HTMLElement): string {
  const value = getComputedStyle(el).getPropertyValue("--color-card-line").trim();
  return value || "#cfe8ff";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface ProfileCard3DProps {
  agent: Agent;
  isOwnAgent: boolean;
}

export function ProfileCard3D({ agent, isOwnAgent }: ProfileCard3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ProfileCardScene | null>(null);
  const [ready, setReady] = useState(false);
  const [avatar, setAvatar] = useState<HTMLImageElement | null>(null);

  // Drive the metal-frame palette: blue in dark mode, brushed silver in light.
  const { resolvedTheme } = useTheme();
  // Seeds the mount-only scene effect with the active mode (captured at mount)
  // so first paint matches without re-creating the WebGL scene; later changes
  // are applied via setFrameTheme below.
  const frameThemeRef = useRef(resolvedTheme);

  // Live agent status for the blinking dot (registers the agent so the central
  // status store polls/streams it even if no list view mounted it).
  useEffect(() => {
    const store = useProfileStatusStore.getState();
    store.registerAgents([{ id: agent.agent_id, machineType: agent.machine_type }]);
    if (agent.machine_type === "remote") {
      store.registerRemoteAgents([{ agent_id: agent.agent_id }]);
    }
  }, [agent.agent_id, agent.machine_type]);

  const { status } = useAvatarState(agent.agent_id);
  const isRemote = agent.machine_type === "remote";
  // Remote agents reflect their real VM state: only a running VM is "online",
  // and the label shows the actual state (Idle, Hibernating, ...) instead of a
  // misleading "Online". Local agents keep the simple online/offline read.
  const isOnline = isRemote
    ? !!status && REMOTE_ONLINE_STATES.has(status)
    : !status || !OFFLINE_STATUSES.has(status);
  const statusLabel = isRemote
    ? status
      ? REMOTE_STATE_LABELS[status] ?? status
      : "Offline"
    : isOnline
      ? "Online"
      : "Offline";

  // Create the WebGL scene once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: ProfileCardScene | null = null;
    try {
      scene = createProfileCardScene(host, {
        accent: readAccent(host),
        lineColor: readLineColor(host),
        reducedMotion: prefersReducedMotion(),
        frameTheme: frameThemeRef.current,
      });
    } catch {
      sceneRef.current = null;
      return;
    }
    sceneRef.current = scene;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only: flip `ready` once the imperative WebGL scene exists so dependent draw effects can run
    setReady(true);
    return () => {
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Re-skin the metal frame live when the user toggles light/dark (the scene
  // itself is not rebuilt).
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setFrameTheme(resolvedTheme);
  }, [ready, resolvedTheme]);

  // Resolve the avatar (CORS-clean) for the LCD.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to the fallback while the new icon resolves async (CORS-clean check) below
    setAvatar(null);
    loadCardAvatar(agent.icon).then((img) => {
      if (!cancelled) setAvatar(img);
    });
    return () => {
      cancelled = true;
    };
  }, [agent.icon]);

  // Redraw the LCD texture whenever inputs change.
  useEffect(() => {
    const scene = sceneRef.current;
    const host = hostRef.current;
    if (!ready || !scene || !host) return;
    drawProfileCardTexture(scene.screenCanvas, {
      agent,
      accent: readAccent(host),
      avatar,
    });
    scene.setLineColor(readLineColor(host));
    scene.refreshTexture();
  }, [ready, agent, avatar]);

  // Redraw the BACK LCD (revealed on flip) with the agent's persona text.
  useEffect(() => {
    const scene = sceneRef.current;
    const host = hostRef.current;
    if (!ready || !scene || !host) return;
    drawPersonalityScreen(scene.backScreenCanvas, {
      personality: agent.personality,
      systemPrompt: agent.system_prompt,
      role: agent.role,
      accent: readAccent(host),
    });
    scene.refreshBackTexture();
  }, [ready, agent.personality, agent.system_prompt, agent.role]);

  // Draw the agent nameplate (name + role) on the worn-metal backplate.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    scene.setInfoRenderer(() => {
      drawInfoStrip(scene.infoCanvas, {
        name: agent.name,
        role: agent.role,
        theme: resolvedTheme,
      });
    });
  }, [ready, agent.name, agent.role, resolvedTheme]);

  // Draw the status label on the card's metal frame (where the barcode was).
  // Local agents read "LOCAL" in purple; remote agents show their live VM state
  // (green when online, red otherwise). Re-runs when the live status changes.
  useEffect(() => {
    const scene = sceneRef.current;
    const host = hostRef.current;
    if (!ready || !scene || !host) return;
    const accent = readAccent(host);
    const badgeLabel = isRemote ? statusLabel : "LOCAL";
    // Local agents read "LOCAL" in purple on the dark frame; on the silver
    // light-mode frame that washes out, so render it near-black for legibility.
    const badgeColor = isRemote
      ? undefined
      : resolvedTheme === "light"
        ? "#15181c"
        : "#a78bfa";
    scene.setStatusRenderer(() => {
      drawStatusBadge(scene.statusCanvas, {
        statusLabel: badgeLabel,
        isOnline,
        accent,
        color: badgeColor,
        theme: resolvedTheme,
      });
    });
  }, [ready, isRemote, statusLabel, isOnline, resolvedTheme]);

  return (
    <div className={styles.card3dContainer}>
      <div ref={hostRef} className={styles.cardCanvasHost} />
      {!isOwnAgent && (
        <div className={styles.card3dActions}>
          <FollowEditButton isOwner={false} targetProfileId={agent.profile_id} />
        </div>
      )}
    </div>
  );
}
