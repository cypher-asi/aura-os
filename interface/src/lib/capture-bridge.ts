import { apps } from "../apps/registry";
import { LAST_APP_KEY, PREVIOUS_PATH_KEY } from "../constants";
import { sanitizeRestorePath } from "../utils/last-app-path";

const DESKTOP_WINDOWS_STORAGE_KEY = "aura:desktopWindows";
const DEMO_PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const appBasePathById = new Map(apps.map((app) => [app.id, app.basePath]));

export interface AuraCaptureSeedPlan {
  schemaVersion?: number;
  mode?: string | null;
  capabilities?: string[];
  requiredState?: string[];
  readinessSignals?: string[];
  notes?: string | null;
}

export interface AuraCaptureResetRequest {
  targetAppId?: string | null;
  targetPath?: string | null;
  seedPlan?: AuraCaptureSeedPlan | null;
  sidekickCollapsed?: boolean;
  timeoutMs?: number;
}

export interface AuraCaptureBridgeState {
  timestamp: string;
  currentPath: string;
  targetPath: string | null;
  targetAppId: string | null;
  routeMatched: boolean;
  activeAppId: string | null;
  activeAppLabel: string | null;
  activeAppMatched: boolean;
  launcherVisible: boolean;
  mainPanelVisible: boolean;
  shellVisible: boolean;
  sidekickVisible: boolean;
  placeholderVisible: boolean;
  feedbackComposerVisible: boolean;
  dialogVisible: boolean;
  sidekickInfoVisible: boolean;
  sidekickPreviewVisible: boolean;
  orgSettingsOpen: boolean;
  buyCreditsOpen: boolean;
  hostSettingsOpen: boolean;
  appsModalOpen: boolean;
  newProjectModalOpen: boolean;
  desktopWindowCount: number;
  seedProofVisible: boolean;
}

function normalizePathname(value: string | null | undefined): string | null {
  const sanitized = sanitizeRestorePath(value);
  if (!sanitized) {
    return null;
  }
  return sanitized.split(/[?#]/, 1)[0] ?? sanitized;
}

function matchesTargetPath(currentPath: string, targetPath: string | null): boolean {
  const expectedPathname = normalizePathname(targetPath);
  if (!expectedPathname) {
    return true;
  }

  const currentPathname = normalizePathname(currentPath);
  if (!currentPathname) {
    return false;
  }

  return currentPathname === expectedPathname
    || currentPathname.startsWith(`${expectedPathname}/`);
}

function isVisible(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && Number(style.opacity || 1) > 0.05
    && rect.width > 0
    && rect.height > 0;
}

function hasVisibleDialogWithText(pattern: RegExp): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
    .some((node) => isVisible(node) && pattern.test(node.textContent || ""));
}

export function resolveAuraCaptureTargetAppId(request: AuraCaptureResetRequest = {}): string | null {
  if (request.targetAppId && appBasePathById.has(request.targetAppId)) {
    return request.targetAppId;
  }

  const targetPathname = normalizePathname(request.targetPath);
  if (!targetPathname) {
    return null;
  }

  const matched = apps.find((app) =>
    targetPathname === app.basePath || targetPathname.startsWith(`${app.basePath}/`),
  );
  return matched?.id ?? null;
}

export function resolveAuraCaptureTargetPath(request: AuraCaptureResetRequest = {}): string | null {
  const explicitPath = sanitizeRestorePath(request.targetPath);
  if (explicitPath) {
    return explicitPath;
  }

  const targetAppId = resolveAuraCaptureTargetAppId(request);
  if (!targetAppId) {
    return null;
  }

  return appBasePathById.get(targetAppId) ?? null;
}

export function persistAuraCaptureTarget(targetPath: string | null, targetAppId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (targetPath) {
      window.localStorage.setItem(PREVIOUS_PATH_KEY, targetPath);
    } else {
      window.localStorage.removeItem(PREVIOUS_PATH_KEY);
    }

    if (targetAppId) {
      window.localStorage.setItem(LAST_APP_KEY, targetAppId);
    } else {
      window.localStorage.removeItem(LAST_APP_KEY);
    }
  } catch {
    // Ignore storage failures inside the screenshot bridge.
  }
}

export function clearAuraDesktopWindowPersistence(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(DESKTOP_WINDOWS_STORAGE_KEY);
  } catch {
    // Ignore storage failures inside the screenshot bridge.
  }
}

export function readAuraCaptureBridgeState(
  request: AuraCaptureResetRequest = {},
): AuraCaptureBridgeState {
  const targetPath = resolveAuraCaptureTargetPath(request);
  const targetAppId = resolveAuraCaptureTargetAppId({
    ...request,
    targetPath,
  });
  const currentPath =
    typeof window === "undefined"
      ? ""
      : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const mainPanel = document.querySelector('[data-agent-surface="main-panel"]');
  const activeAppId = mainPanel?.getAttribute("data-agent-active-app-id") || null;
  const activeAppLabel = mainPanel?.getAttribute("data-agent-active-app-label") || null;
  const launcherVisible = Array.from(document.querySelectorAll('[data-agent-role="app-launcher"]'))
    .some((node) => isVisible(node));
  const mainPanelVisible = isVisible(mainPanel);
  const sidekickVisible = isVisible(document.querySelector('[data-agent-surface="sidekick-panel"]'));
  const placeholderVisible = isVisible(document.querySelector('[data-agent-surface="shell-route-placeholder"]'));
  const feedbackComposerVisible = isVisible(document.querySelector('[data-agent-surface="feedback-composer"]'));
  const dialogVisible = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
    .some((node) => isVisible(node));
  const seedProofVisible = Array.from(document.querySelectorAll("[data-agent-proof]"))
    .some((node) => isVisible(node));

  return {
    timestamp: new Date().toISOString(),
    currentPath,
    targetPath,
    targetAppId,
    routeMatched: matchesTargetPath(currentPath, targetPath),
    activeAppId,
    activeAppLabel,
    activeAppMatched: targetAppId ? activeAppId === targetAppId : true,
    launcherVisible,
    mainPanelVisible,
    shellVisible: launcherVisible || mainPanelVisible,
    sidekickVisible,
    placeholderVisible,
    feedbackComposerVisible,
    dialogVisible,
    sidekickInfoVisible: Boolean(document.querySelector('[data-sidekick-info="true"]')),
    sidekickPreviewVisible: Boolean(document.querySelector('[data-sidekick-preview="true"]')),
    orgSettingsOpen: hasVisibleDialogWithText(/\bteam settings\b/i),
    buyCreditsOpen: hasVisibleDialogWithText(/\bbuy credits\b/i),
    hostSettingsOpen: hasVisibleDialogWithText(/\bhost connection\b/i),
    appsModalOpen: hasVisibleDialogWithText(/\bvisible in taskbar\b/i),
    newProjectModalOpen: hasVisibleDialogWithText(/\bnew project\b/i),
    desktopWindowCount: document.querySelectorAll('[data-window-layer-host="true"] [data-agent-id]').length,
    seedProofVisible,
  };
}

function seedText(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): string {
  return [
    targetAppId,
    ...(seedPlan?.capabilities ?? []),
    ...(seedPlan?.requiredState ?? []),
    ...(seedPlan?.readinessSignals ?? []),
    seedPlan?.notes,
  ].filter(Boolean).join("\n").toLowerCase();
}

export function shouldApplyAura3DSeed(seedPlan: AuraCaptureSeedPlan | null | undefined, targetAppId: string | null): boolean {
  return /\b(?:app:aura3d|aura3d|aura 3d|3d|generated image|asset gallery|model preview)\b/i.test(seedText(seedPlan, targetAppId));
}

function demoImageDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1020"/>
      <stop offset="0.48" stop-color="#1d2d68"/>
      <stop offset="1" stop-color="#060816"/>
    </linearGradient>
    <radialGradient id="spot" cx="50%" cy="36%" r="46%">
      <stop offset="0" stop-color="#dbeafe" stop-opacity="0.95"/>
      <stop offset="0.42" stop-color="#60a5fa" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#1d4ed8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="front" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dbeafe"/>
      <stop offset="1" stop-color="#3b82f6"/>
    </linearGradient>
    <linearGradient id="side" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#60a5fa"/>
      <stop offset="1" stop-color="#1e3a8a"/>
    </linearGradient>
    <linearGradient id="top" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#93c5fd"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>
  <rect width="1600" height="1000" fill="url(#bg)"/>
  <rect width="1600" height="1000" fill="url(#spot)"/>
  <ellipse cx="805" cy="760" rx="390" ry="88" fill="#020617" opacity="0.42" filter="url(#soft)"/>
  <polygon points="805,190 1125,370 805,550 485,370" fill="url(#top)" opacity="0.96"/>
  <polygon points="485,370 805,550 805,810 485,625" fill="url(#front)" opacity="0.94"/>
  <polygon points="1125,370 805,550 805,810 1125,620" fill="url(#side)" opacity="0.96"/>
  <path d="M805 190v360M485 370v255M1125 370v250M805 810V550" stroke="#eff6ff" stroke-width="8" opacity="0.38"/>
  <circle cx="1010" cy="268" r="58" fill="#ffffff" opacity="0.74"/>
  <circle cx="1010" cy="268" r="96" fill="#93c5fd" opacity="0.22"/>
  <path d="M605 646c118 72 282 72 400 0" fill="none" stroke="#dbeafe" stroke-width="18" stroke-linecap="round" opacity="0.5"/>
  <path d="M632 695c100 48 246 48 346 0" fill="none" stroke="#bfdbfe" stroke-width="10" stroke-linecap="round" opacity="0.38"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function applyAuraCaptureSeedPlan(
  seedPlan: AuraCaptureSeedPlan | null | undefined,
  targetAppId: string | null,
): Promise<Record<string, unknown>> {
  const applied: string[] = [];

  if (shouldApplyAura3DSeed(seedPlan, targetAppId)) {
    const { useAura3DStore } = await import("../stores/aura3d-store");
    const image = {
      id: "capture-demo-image",
      artifactId: "capture-demo-image-artifact",
      prompt: "A polished translucent 3D product cube on a cinematic dark background",
      imageUrl: demoImageDataUri(),
      originalUrl: demoImageDataUri(),
      model: "gpt-image-2",
      createdAt: new Date().toISOString(),
      meta: { captureDemo: true },
    };
    useAura3DStore.setState((state) => ({
      selectedProjectId: DEMO_PROJECT_ID,
      activeTab: "image",
      imaginePrompt: "A polished translucent 3D product cube",
      imagineModel: "gpt-image-2",
      isGeneratingImage: false,
      imageProgress: 100,
      imageProgressMessage: "Ready",
      partialImageData: null,
      currentImage: image,
      generateSourceImage: image,
      current3DModel: null,
      images: [image],
      models: [],
      selectedImageId: image.id,
      selectedModelId: null,
      sidekickTab: "images",
      error: null,
      isLoadingArtifacts: false,
      loadedProjectIds: new Set([...state.loadedProjectIds, DEMO_PROJECT_ID]),
    }));
    applied.push("aura3d-demo-generated-image");
  }

  return {
    ok: true,
    applied,
    capabilities: seedPlan?.capabilities ?? [],
  };
}
