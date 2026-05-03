import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  SETTINGS_SECTIONS,
  isSettingsSectionId,
  type SettingsSection,
} from "../../../views/SettingsView/sections";
import { SettingsList } from "./SettingsList";
import { SettingsDetailScreen } from "./SettingsDetailScreen";

export function MobileSettingsView() {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();

  if (!section) {
    return (
      <SettingsList
        onSelect={(id) => navigate(`/projects/settings/${id}`)}
      />
    );
  }

  if (!isSettingsSectionId(section)) {
    return <Navigate to="/projects/settings" replace />;
  }

  const entry: SettingsSection | undefined = SETTINGS_SECTIONS.find(
    (s) => s.id === section,
  );
  if (!entry) {
    return <Navigate to="/projects/settings" replace />;
  }

  return (
    <SettingsDetailScreen
      entry={entry}
      onBack={() => navigate("/projects/settings")}
    />
  );
}
