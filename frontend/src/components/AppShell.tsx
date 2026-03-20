import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { SettingsModal } from "./SettingsModal";
import { OrgSettingsPanel } from "./OrgSettingsPanel";
import { AppProviders } from "./AppProviders";
import { useSidekick } from "../context/SidekickContext";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { NewProjectModal } from "./NewProjectModal";
import { INSUFFICIENT_CREDITS_EVENT } from "../api/client";
import { DesktopShell } from "./DesktopShell";
import { MobileShell } from "./MobileShell";

function ProjectCreationModalHost() {
  const navigate = useNavigate();
  const sidekick = useSidekick();
  const { setProjects, newProjectModalOpen, closeNewProjectModal } = useProjectsList();

  const handleProjectCreated = useCallback((project: import("../types").Project) => {
    closeNewProjectModal();
    sidekick.closePreview();
    setProjects((prev) => {
      const next = prev.filter((existing) => existing.project_id !== project.project_id);
      return [...next, project];
    });
    navigate(`/projects/${project.project_id}`);
  }, [closeNewProjectModal, navigate, setProjects, sidekick]);

  return (
    <NewProjectModal
      isOpen={newProjectModalOpen}
      onClose={closeNewProjectModal}
      onCreated={handleProjectCreated}
    />
  );
}

function ResponsiveShell({
  onOpenOrgSettings,
  onOpenSettings,
  onBuyCredits,
}: {
  onOpenOrgSettings: () => void;
  onOpenSettings: () => void;
  onBuyCredits: () => void;
}) {
  const { isMobileLayout } = useAuraCapabilities();

  return isMobileLayout ? (
    <MobileShell
      onOpenOrgSettings={onOpenOrgSettings}
      onOpenSettings={onOpenSettings}
    />
  ) : (
    <DesktopShell
      onOpenOrgSettings={onOpenOrgSettings}
      onBuyCredits={onBuyCredits}
    />
  );
}

function AppContent() {
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);
  const [orgInitialSection, setOrgInitialSection] = useState<"billing" | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openOrgBilling = useCallback(() => {
    setOrgInitialSection("billing");
    setOrgSettingsOpen(true);
  }, []);

  const openOrgSettings = useCallback(() => setOrgSettingsOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeOrgSettings = useCallback(() => {
    setOrgSettingsOpen(false);
    setOrgInitialSection(undefined);
  }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    const handler = () => openOrgBilling();
    window.addEventListener(INSUFFICIENT_CREDITS_EVENT, handler);
    return () => window.removeEventListener(INSUFFICIENT_CREDITS_EVENT, handler);
  }, [openOrgBilling]);

  return (
    <>
      <ResponsiveShell
        onOpenOrgSettings={openOrgSettings}
        onOpenSettings={openSettings}
        onBuyCredits={openOrgBilling}
      />

      <OrgSettingsPanel
        isOpen={orgSettingsOpen}
        onClose={closeOrgSettings}
        initialSection={orgInitialSection}
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
