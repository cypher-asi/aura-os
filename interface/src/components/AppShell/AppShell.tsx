import { lazy, Suspense, useCallback, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppProviders } from "../AppProviders";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useShallow } from "zustand/react/shallow";
import { DesktopShell } from "../DesktopShell";
import { MobileShell } from "../MobileShell";
import { signalDesktopReady } from "../../lib/desktop-ready";
import { markShellVisible } from "../../lib/perf/startup-perf";

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
  useLayoutEffect(() => {
    markShellVisible();
    signalDesktopReady();
  }, []);

  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}
