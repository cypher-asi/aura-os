import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Bell, Info, Keyboard, Languages, Paintbrush, Settings, User } from "lucide-react";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { NotificationsSection } from "./NotificationsSection";
import { KeyboardSection } from "./KeyboardSection";
import { AdvancedSection } from "./AdvancedSection";
import { LanguageSection } from "./LanguageSection";
import { SettingsProfile } from "../../components/SettingsProfile";

export type SettingsSectionId =
  | "you"
  | "about"
  | "appearance"
  | "notifications"
  | "keyboard"
  | "language"
  | "advanced";

export type SettingsSection = {
  readonly id: SettingsSectionId;
  /** English fallback label. Prefer `labelKey` resolved via i18n at render. */
  readonly label: string;
  /** i18n key in the `settings` namespace (e.g. `sections.you`). */
  readonly labelKey: string;
  readonly icon: LucideIcon;
  readonly Pane: ComponentType;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "you", label: "You", labelKey: "sections.you", icon: User, Pane: SettingsProfile },
  { id: "about", label: "About", labelKey: "sections.about", icon: Info, Pane: AboutSection },
  { id: "appearance", label: "Theme", labelKey: "sections.appearance", icon: Paintbrush, Pane: AppearanceSection },
  { id: "notifications", label: "Notifications", labelKey: "sections.notifications", icon: Bell, Pane: NotificationsSection },
  { id: "keyboard", label: "Keyboard", labelKey: "sections.keyboard", icon: Keyboard, Pane: KeyboardSection },
  { id: "language", label: "Language", labelKey: "sections.language", icon: Languages, Pane: LanguageSection },
  { id: "advanced", label: "Advanced", labelKey: "sections.advanced", icon: Settings, Pane: AdvancedSection },
];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "you";

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
