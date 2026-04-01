import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { SettingsModal } from "../SettingsModal";
import { OrgSettingsPanel } from "../OrgSettingsPanel";
import { BuyCreditsModal } from "../BuyCreditsModal";
import { AppProviders } from "../AppProviders";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { NewProjectModal } from "../NewProjectModal";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useShallow } from "zustand/react/shallow";
import { DesktopShell } from "../DesktopShell";
import { MobileShell } from "../MobileShell";

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

  return (
    <NewProjectModal
      isOpen={newProjectModalOpen}
      onClose={closeNewProjectModal}
      onCreated={handleProjectCreated}
    />
  );
}

function ResponsiveShell() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileShell /> : <DesktopShell />;
}

function AppContent() {
  const {
    orgSettingsOpen, orgInitialSection, closeOrgSettings,
    settingsOpen, closeSettings,
    buyCreditsOpen, closeBuyCredits, openOrgBilling,
  } = useUIModalStore(
    useShallow((s) => ({
      orgSettingsOpen: s.orgSettingsOpen,
      orgInitialSection: s.orgInitialSection,
      closeOrgSettings: s.closeOrgSettings,
      settingsOpen: s.settingsOpen,
      closeSettings: s.closeSettings,
      buyCreditsOpen: s.buyCreditsOpen,
      closeBuyCredits: s.closeBuyCredits,
      openOrgBilling: s.openOrgBilling,
    })),
  );

  return (
    <>
      <ResponsiveShell />

      <OrgSettingsPanel
        isOpen={orgSettingsOpen}
        onClose={closeOrgSettings}
        initialSection={orgInitialSection}
      />
      <BuyCreditsModal
        isOpen={buyCreditsOpen}
        onClose={closeBuyCredits}
        onOpenBilling={openOrgBilling}
      />
      <SettingsModal isOpen={settingsOpen} onClose={closeSettings} />
      <ProjectCreationModalHost />
    </>
  );
}

export function AppShell() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}
