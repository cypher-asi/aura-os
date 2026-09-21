import type { ComponentType } from "react";
import {
  Palette,
  Type,
  LayoutGrid,
  Droplets,
  Sparkles,
  Zap,
  Image,
  Signature,
  Bookmark,
  type LucideIcon,
} from "lucide-react";
import { ModeAccentPane } from "./panes/ModeAccentPane";
import { TypographyPane } from "./panes/TypographyPane";
import { LayoutPane } from "./panes/LayoutPane";
import { ColorsPane } from "./panes/ColorsPane";
import { EffectsPane } from "./panes/EffectsPane";
import { MotionPane } from "./panes/MotionPane";
import { BackgroundPane } from "./panes/BackgroundPane";
import { LogoPane } from "./panes/LogoPane";
import { PresetsPane } from "./panes/PresetsPane";

export type ThemeSubAreaId =
  | "mode"
  | "typography"
  | "layout"
  | "colors"
  | "effects"
  | "motion"
  | "background"
  | "logo"
  | "presets";

export type ThemeSubArea = {
  id: ThemeSubAreaId;
  label: string;
  /**
   * Logical group this sub-area belongs to. Adjacent sub-areas sharing a
   * group render under a single header, both in the drill-down sub-nav and in
   * the stacked route/mobile view.
   */
  group: string;
  icon: LucideIcon;
  Component: ComponentType;
};

/**
 * Ordered registry of Theme sub-areas. Consumed two ways:
 *  - `AppearanceSection` stacks every pane on one scroll (route page + mobile).
 *  - `OrgSettingsPanel` drill-down renders one pane at a time behind a
 *    "<- Settings > Theme" breadcrumb and lists these as the sub-nav.
 *
 * Keep entries grouped (and group members adjacent) so the shared header
 * grouping logic reads as a clean outline.
 */
export const THEME_SUB_AREAS: readonly ThemeSubArea[] = [
  { id: "mode", label: "Mode & accent", group: "Appearance", icon: Palette, Component: ModeAccentPane },
  { id: "typography", label: "Typography", group: "Appearance", icon: Type, Component: TypographyPane },
  { id: "layout", label: "Layout & density", group: "Appearance", icon: LayoutGrid, Component: LayoutPane },
  { id: "colors", label: "Custom colors", group: "Customization", icon: Droplets, Component: ColorsPane },
  { id: "effects", label: "Effects", group: "Customization", icon: Sparkles, Component: EffectsPane },
  { id: "motion", label: "Motion", group: "Customization", icon: Zap, Component: MotionPane },
  { id: "logo", label: "Aura logo", group: "Customization", icon: Signature, Component: LogoPane },
  { id: "background", label: "Background", group: "Desktop", icon: Image, Component: BackgroundPane },
  { id: "presets", label: "Presets", group: "Library", icon: Bookmark, Component: PresetsPane },
];

/**
 * Collapses {@link THEME_SUB_AREAS} (or a subset) into ordered groups, each a
 * header label plus its adjacent members. Shared by the drill-down sub-nav and
 * the stacked route/mobile view so both render the same logical sections.
 */
export function groupThemeSubAreas(
  subAreas: readonly ThemeSubArea[],
): { group: string; items: ThemeSubArea[] }[] {
  return subAreas.reduce<{ group: string; items: ThemeSubArea[] }[]>(
    (acc, subArea) => {
      const last = acc[acc.length - 1];
      if (last && last.group === subArea.group) {
        last.items.push(subArea);
      } else {
        acc.push({ group: subArea.group, items: [subArea] });
      }
      return acc;
    },
    [],
  );
}

export const DEFAULT_THEME_SUB_AREA: ThemeSubAreaId = "mode";
