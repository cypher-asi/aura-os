import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppProviders } from "../AppProviders";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useAttachCreatedAgent } from "../../hooks/use-attach-created-agent";
import { api } from "../../api/client";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useAuth } from "../../stores/auth-store";
import { useAura3DStore } from "../../stores/aura3d-store";
import { DEFAULT_IMAGE_MODEL_ID } from "../../constants/models";
import { getDefaultOnboardingIntent, type OnboardingRuntime } from "../../features/onboarding/onboarding-constants";
import { useOnboardingStore } from "../../features/onboarding/onboarding-store";
import { useOnboardingTaskWatcher } from "../../features/onboarding/useOnboardingTaskWatcher";
import { useApplyAgentOnboarding } from "../../views/public-chat/AgentOnboarding/useApplyAgentOnboarding";
import { useShallow } from "zustand/react/shallow";
import { AuraShell } from "../AuraShell";
import { ForcedUpgradeOverlay } from "../ForcedUpgrade";
import { RecordDemoSetupModal } from "../RecordDemoSetupModal/RecordDemoSetupModal";
import { MobileShell, MobilePublicShell } from "../../mobile/shell";
import { useUIModeStore } from "../../stores/ui-mode-store";
import { useEffectiveMode } from "../../stores/use-effective-mode";
import { markShellVisible } from "../../lib/perf/startup-perf";
import {
  applyAuraCaptureSeedPlan,
  clearAuraDesktopWindowPersistence,
  type AuraCaptureSeedPlan,
  persistAuraCaptureTarget,
  readAuraCaptureBridgeState,
  resolveAuraCaptureTargetAppId,
  resolveAuraCaptureTargetPath,
} from "../../lib/capture-bridge";
import { markAuraCaptureSessionActive, shouldEnableAuraScreenshotBridge } from "../../lib/screenshot-bridge";
import { isDemoRecordingWindow, postDesktopIpc, runDemoInstruction } from "../../lib/demo-bridge";
import { awaitInitialShellAppReady } from "../../lib/boot-shell";

const BuyCreditsModal = lazy(() =>
  import("../BuyCreditsModal").then((module) => ({ default: module.BuyCreditsModal })),
);
const OrgSettingsPanel = lazy(() =>
  import("../OrgSettingsPanel").then((module) => ({ default: module.OrgSettingsPanel })),
);
const NewProjectModal = lazy(() =>
  import("../NewProjectModal").then((module) => ({ default: module.NewProjectModal })),
);
const AppsModal = lazy(() =>
  import("../AppsModal").then((module) => ({ default: module.AppsModal })),
);
const OnboardingChecklist = lazy(() =>
  import("../../features/onboarding/OnboardingChecklist/OnboardingChecklist").then((module) => ({ default: module.OnboardingChecklist })),
);

function ProjectCreationModalHost() {
  const navigate = useNavigate();
  const closePreview = useSidekickStore((s) => s.closePreview);
  const { prependProject, newProjectModalOpen, closeNewProjectModal } = useProjectsList();
  const attachCreatedAgent = useAttachCreatedAgent();

  // Auto-create a Standard Agent on every new project and route the
  // user straight into that agent's chat with a `create-agent` handoff
  // state. `ChatPanel` keys off that state to focus the input bar on
  // desktop, so the user lands ready to type instead of on
  // `ProjectEmptyView` having to click "Add Agent" themselves. If the
  // agent call fails we still want the project to exist, so we fall
  // back to the empty-state route and let the user pick an agent
  // manually.
  const handleProjectCreated = useCallback(
    async (project: import("../../shared/types").Project) => {
      closePreview();
      prependProject(project);
      try {
        // Tag this binding as a system-side auto-attach so the
        // projects sidebar's `isUserFacingAgentInstance` filter hides
        // it -- the user created a project, they didn't click "+" on
        // the Standard Agent. Visible to the chat / detail surfaces
        // via the normal redirect below.
        const instance = await api.createGeneralAgentInstance(project.project_id, {
          source: "auto_project_default",
        });
        attachCreatedAgent(instance);
      } catch (err) {
        console.error("Failed to auto-create Standard Agent for new project", err);
        navigate(`/projects/${project.project_id}`);
      } finally {
        closeNewProjectModal();
      }
    },
    [attachCreatedAgent, closeNewProjectModal, closePreview, navigate, prependProject],
  );

  if (!newProjectModalOpen) {
    return null;
  }

  return (
    <LazyModalBoundary>
      <NewProjectModal
        isOpen={newProjectModalOpen}
        onClose={closeNewProjectModal}
        onCreated={handleProjectCreated}
      />
    </LazyModalBoundary>
  );
}

function ResponsiveShell() {
  const { isMobileLayout } = useAuraCapabilities();
  const uiMode = useUIModeStore((s) => s.mode);
  const effectiveMode = useEffectiveMode();

  useEffect(() => {
    void import("../../lib/analytics").then(({ registerProperty }) => {
      registerProperty("app_mode", isMobileLayout ? "mobile" : uiMode);
    });
  }, [uiMode, isMobileLayout]);

  if (isMobileLayout) {
    // Public visitors on mobile get a dedicated chrome
    // (`MobilePublicShell`) — `MobileShell` is project/auth coupled
    // and would not render a logged-out surface correctly.
    return effectiveMode === "public" ? <MobilePublicShell /> : <MobileShell />;
  }
  return <AuraShell />;
}

function LazyModalBoundary({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

function waitForMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function resetCaptureAppSpecificState(): Promise<void> {
  const results = await Promise.allSettled([
    import("../../stores/feedback-store").then(({ useFeedbackStore }) => {
      useFeedbackStore.setState({
        selectedId: null,
        isComposerOpen: false,
        composerError: null,
      });
    }),
    import("../../apps/agents/stores/agent-sidekick-store").then(({ useAgentSidekickStore }) => {
      useAgentSidekickStore.setState({
        activeTab: "profile",
        previewItem: null,
        previewHistory: [],
        canGoBack: false,
        showEditor: false,
        showDeleteConfirm: false,
      });
    }),
    import("../../apps/agents/stores/agent-store").then(({ useAgentStore }) => {
      useAgentStore.setState({
        selectedAgentId: null,
      });
    }),
    import("../../apps/process/stores/process-sidekick-store").then(({ useProcessSidekickStore }) => {
      useProcessSidekickStore.setState({
        activeTab: "process",
        activeNodeTab: "info",
        previewItem: null,
        previewRun: null,
        previewHistory: [],
        canGoBack: false,
        selectedNode: null,
        showEditor: false,
        showDeleteConfirm: false,
        nodeEditRequested: false,
        nodeStatuses: {},
        liveRunNodeId: null,
      });
    }),
    Promise.resolve().then(() => {
      useAura3DStore.setState({
        activeTab: "image",
        selectedProjectId: null,
        imaginePrompt: "",
        imagineModel: DEFAULT_IMAGE_MODEL_ID,
        isGeneratingImage: false,
        imageProgress: 0,
        imageProgressMessage: "",
        partialImageData: null,
        currentImage: null,
        generateSourceImage: null,
        isGenerating3D: false,
        generate3DProgress: 0,
        generate3DProgressMessage: "",
        current3DModel: null,
        images: [],
        models: [],
        selectedImageId: null,
        selectedModelId: null,
        sidekickTab: "images",
        error: null,
      });
    }),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[aura-capture-bridge] optional reset failed", result.reason);
    }
  }
}

async function waitForCaptureShell(
  targetPath: string | null,
  targetAppId: string | null,
  timeoutMs: number,
) {
  const startedAt = Date.now();
  let lastState = readAuraCaptureBridgeState({ targetPath, targetAppId });

  while (Date.now() - startedAt < timeoutMs) {
    lastState = readAuraCaptureBridgeState({ targetPath, targetAppId });
    const overlaysClosed =
      !lastState.dialogVisible &&
      !lastState.sidekickInfoVisible &&
      !lastState.sidekickPreviewVisible;

    if (
      lastState.shellVisible &&
      lastState.routeMatched &&
      lastState.activeAppMatched &&
      lastState.desktopWindowCount === 0 &&
      overlaysClosed
    ) {
      await waitForMs(140);
      return readAuraCaptureBridgeState({ targetPath, targetAppId });
    }

    await waitForMs(80);
  }

  return lastState;
}

function CaptureBridgeHost() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!shouldEnableAuraScreenshotBridge()) {
      delete window.__AURA_CAPTURE_BRIDGE__;
      return;
    }

    const bridge = {
      version: 1,
      getState() {
        return readAuraCaptureBridgeState();
      },
      async resetShell(rawOptions: Record<string, unknown> = {}) {
        const requestedTargetPath = resolveAuraCaptureTargetPath({
          targetAppId:
            typeof rawOptions.targetAppId === "string" ? rawOptions.targetAppId : null,
          targetPath:
            typeof rawOptions.targetPath === "string" ? rawOptions.targetPath : null,
        });
        const targetPath = requestedTargetPath ?? "/agents";
        const targetAppId =
          resolveAuraCaptureTargetAppId({
            targetAppId:
              typeof rawOptions.targetAppId === "string" ? rawOptions.targetAppId : null,
            targetPath,
          }) ?? "agents";
        const sidekickCollapsed = rawOptions.sidekickCollapsed === true;
        const seedPlan =
          rawOptions.seedPlan && typeof rawOptions.seedPlan === "object"
            ? rawOptions.seedPlan as AuraCaptureSeedPlan
            : null;
        const timeoutMs =
          typeof rawOptions.timeoutMs === "number" && rawOptions.timeoutMs > 0
            ? rawOptions.timeoutMs
            : 6_000;

        markAuraCaptureSessionActive();
        useUIModalStore.setState({
          orgSettingsOpen: false,
          orgInitialSection: undefined,
          buyCreditsOpen: false,
          hostSettingsOpen: false,
          appsModalOpen: false,
        });
        useProjectsListStore.setState({ newProjectModalOpen: false });
        useSidekickStore.setState({
          activeTab: "terminal",
          previewItem: null,
          previewHistory: [],
          canGoBack: false,
          showInfo: false,
          infoContent: null,
        });
        useDesktopWindowStore.setState({
          windows: {},
          nextZ: 1,
        });
        useAppUIStore.setState({
          visitedAppIds: new Set<string>(),
          sidebarQueries: {},
          sidebarActions: {},
          sidekickCollapsed,
          previousPath: targetPath,
        });
        clearAuraDesktopWindowPersistence();
        await resetCaptureAppSpecificState();
        const seedResult = await applyAuraCaptureSeedPlan(seedPlan, targetAppId);

        const viaDesktopPath = targetPath === "/desktop" ? null : "/desktop";
        if (viaDesktopPath) {
          persistAuraCaptureTarget(viaDesktopPath, "desktop");
          navigate(viaDesktopPath, { replace: true });
          await waitForMs(180);
        }

        persistAuraCaptureTarget(targetPath, targetAppId);
        navigate(targetPath, { replace: true });
        let finalState = await waitForCaptureShell(targetPath, targetAppId, timeoutMs);
        const routeSeedResult = await applyAuraCaptureSeedPlan(seedPlan, targetAppId);
        await waitForMs(180);
        finalState = await waitForCaptureShell(targetPath, targetAppId, Math.min(timeoutMs, 2_500));

        return {
          ok: finalState.routeMatched && finalState.activeAppMatched && finalState.shellVisible,
          targetPath,
          targetAppId,
          sidekickCollapsed,
          seed: {
            ...routeSeedResult,
            applied: [
              ...((seedResult.applied as string[] | undefined) ?? []),
              ...((routeSeedResult.applied as string[] | undefined) ?? []),
            ],
            beforeNavigation: seedResult,
            afterNavigation: routeSeedResult,
          },
          state: finalState,
        };
      },
    };

    window.__AURA_CAPTURE_BRIDGE__ = bridge;
    return () => {
      if (window.__AURA_CAPTURE_BRIDGE__ === bridge) {
        delete window.__AURA_CAPTURE_BRIDGE__;
      }
    };
  }, [navigate]);

  return null;
}

/**
 * Installs `window.__AURA_DEMO_BRIDGE__` so the native shell can drive a
 * scripted demo in this window. When this is the dedicated recording window
 * (marked via `window.__AURA_DEMO_RECORDING__`), it signals `demo-ready` to
 * the shell so ffmpeg capture + driving begin.
 */
function DemoBridgeHost() {
  const navigate = useNavigate();

  useEffect(() => {
    const bridge = {
      version: 1,
      run: (instruction: string, opts?: { agentId?: string; timeoutMs?: number }) =>
        runDemoInstruction(navigate, instruction, opts),
    };
    window.__AURA_DEMO_BRIDGE__ = bridge;

    let cancelled = false;
    if (isDemoRecordingWindow()) {
      // Mirror the normal-window reveal (`splash-ready` in `main.tsx`): only
      // signal the shell to reveal the window + start ffmpeg once the initial
      // shell app module is loaded and painted. Otherwise the recording window
      // popped up — and started recording — on a blank/loading frame while a
      // normal window appeared instantly with content. `awaitInitialShellAppReady`
      // resolves when the module is ready or after its own safety timeout, so
      // this can never deadlock the recording.
      void awaitInitialShellAppReady().finally(() => {
        if (!cancelled) postDesktopIpc("demo-ready");
      });
    }

    return () => {
      cancelled = true;
      if (window.__AURA_DEMO_BRIDGE__ === bridge) {
        delete window.__AURA_DEMO_BRIDGE__;
      }
    };
  }, [navigate]);

  return null;
}

function useOnboardingHydration() {
  const user = useAuth().user;
  const { hasDesktopBridge } = useAuraCapabilities();
  const hydrateForUser = useOnboardingStore((s) => s.hydrateForUser);
  const completeWelcomeIfNeeded = useOnboardingStore((s) => s.completeWelcomeIfNeeded);
  const dismissChecklist = useOnboardingStore((s) => s.dismissChecklist);
  const trackedUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.user_id) return;
    hydrateForUser(user.user_id);
    const runtime: OnboardingRuntime = hasDesktopBridge ? "desktop" : "web";
    completeWelcomeIfNeeded(getDefaultOnboardingIntent(runtime), {
      checklistDismissed: runtime === "web",
    });
    if (runtime === "web") {
      dismissChecklist();
    }
    if (trackedUserIdRef.current !== user.user_id) {
      trackedUserIdRef.current = user.user_id;
      import("../../lib/analytics").then(({ identifyUser }) => {
        identifyUser(user.user_id);
      });
    }
  }, [completeWelcomeIfNeeded, dismissChecklist, hasDesktopBridge, hydrateForUser, user?.user_id]);
}

function AppContent() {
  useOnboardingHydration();
  useOnboardingTaskWatcher();
  useApplyAgentOnboarding();
  const uiMode = useUIModeStore((s) => s.mode);

  const {
    orgSettingsOpen, orgInitialSection, orgInitialSubArea, closeOrgSettings,
    buyCreditsOpen, closeBuyCredits, openOrgBilling,
    appsModalOpen, closeAppsModal,
  } = useUIModalStore(
    useShallow((s) => ({
      orgSettingsOpen: s.orgSettingsOpen,
      orgInitialSection: s.orgInitialSection,
      orgInitialSubArea: s.orgInitialSubArea,
      closeOrgSettings: s.closeOrgSettings,
      buyCreditsOpen: s.buyCreditsOpen,
      closeBuyCredits: s.closeBuyCredits,
      openOrgBilling: s.openOrgBilling,
      appsModalOpen: s.appsModalOpen,
      closeAppsModal: s.closeAppsModal,
    })),
  );

  return (
    <>
      <CaptureBridgeHost />
      <DemoBridgeHost />
      <RecordDemoSetupModal />
      <ResponsiveShell />

      {orgSettingsOpen ? (
        <LazyModalBoundary>
          <OrgSettingsPanel
            isOpen={orgSettingsOpen}
            onClose={closeOrgSettings}
            initialSection={orgInitialSection}
            initialSubArea={orgInitialSubArea}
          />
        </LazyModalBoundary>
      ) : null}
      {buyCreditsOpen ? (
        <LazyModalBoundary>
          <BuyCreditsModal
            isOpen={buyCreditsOpen}
            onClose={closeBuyCredits}
            onOpenBilling={openOrgBilling}
          />
        </LazyModalBoundary>
      ) : null}
      {appsModalOpen ? (
        <LazyModalBoundary>
          <AppsModal isOpen={appsModalOpen} onClose={closeAppsModal} />
        </LazyModalBoundary>
      ) : null}
      <ProjectCreationModalHost />
      {uiMode === "standard" && (
        <LazyModalBoundary>
          <OnboardingChecklist />
        </LazyModalBoundary>
      )}
      <ForcedUpgradeOverlay />
    </>
  );
}

export function AppShell() {
  // Window visibility is signaled from `main.tsx` after React's first paint,
  // so this component does not need to call `signalDesktopReady()` anymore.
  // Keeping `markShellVisible()` for startup perf instrumentation only.
  useLayoutEffect(() => {
    markShellVisible();
  }, []);

  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}
