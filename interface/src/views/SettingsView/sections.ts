import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Bell, Info, Keyboard, Paintbrush, Settings } from "lucide-react";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { NotificationsSection } from "./NotificationsSection";
import { KeyboardSection } from "./KeyboardSection";
import { AdvancedSection } from "./AdvancedSection";

export type SettingsSectionId =
  | "about"
  | "appearance"
  | "notifications"
  | "keyboard"
  | "advanced";

export type SettingsSection = {
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly Pane: ComponentType;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "about", label: "About", icon: Info, Pane: AboutSection },
  { id: "appearance", label: "Appearance", icon: Paintbrush, Pane: AppearanceSection },
  { id: "notifications", label: "Notifications", icon: Bell, Pane: NotificationsSection },
  { id: "keyboard", label: "Keyboard", icon: Keyboard, Pane: KeyboardSection },
  { id: "advanced", label: "Advanced", icon: Settings, Pane: AdvancedSection },
];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "about";

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((s) => s.id === value);
}

export function getSettingsSection(id: SettingsSectionId): SettingsSection {
  const found = SETTINGS_SECTIONS.find((s) => s.id === id);
  if (!found) {
    throw new Error(`Unknown settings section id: ${id}`);
  }
  return found;
}
