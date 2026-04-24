import { lazy, Suspense, useCallback, useEffect, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppProviders } from "../AppProviders";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useShallow } from "zustand/react/shallow";
import { DesktopShell } from "../DesktopShell";
import { MobileShell } from "../MobileShell";
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
import { shouldEnableAuraScreenshotBridge } from "../../lib/screenshot-bridge";

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

function ProjectCreationModalHost() {
  const navigate = useNavigate();
  const closePreview = useSidekickStore((s) => s.closePreview);
  const { setProjects, newProjectModalOpen, closeNewProjectModal } = useProjectsList();

  const handleProjectCreated = useCallback((project: import("../../types").Project) => {
    closeNewProjectModal();
    closePreview();
    setProjects((prev) => {
      const next = prev.filter((existing) => existing.project_id !== project.project_id);
      return [...next, project];
    });
    navigate(`/projects/${project.project_id}`);
  }, [closeNewProjectModal, navigate, setProjects, closePreview]);

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
  return isMobileLayout ? <MobileShell /> : <DesktopShell />;
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
    import("../../stores/aura3d-store").then(({ useAura3DStore }) => {
      useAura3DStore.setState({
        activeTab: "image",
        selectedProjectId: null,
        imaginePrompt: "",
        imagineModel: "gpt-image-1",
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
        const finalState = await waitForCaptureShell(targetPath, targetAppId, timeoutMs);

        return {
          ok: finalState.routeMatched && finalState.activeAppMatched && finalState.shellVisible,
          targetPath,
          targetAppId,
          sidekickCollapsed,
          seed: seedResult,
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

function AppContent() {
  const {
    orgSettingsOpen, orgInitialSection, closeOrgSettings,
    buyCreditsOpen, closeBuyCredits, openOrgBilling,
    appsModalOpen, closeAppsModal,
  } = useUIModalStore(
    useShallow((s) => ({
      orgSettingsOpen: s.orgSettingsOpen,
      orgInitialSection: s.orgInitialSection,
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
      <ResponsiveShell />

      {orgSettingsOpen ? (
        <LazyModalBoundary>
          <OrgSettingsPanel
            isOpen={orgSettingsOpen}
            onClose={closeOrgSettings}
            initialSection={orgInitialSection}
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
