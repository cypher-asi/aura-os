import { MockAuraApp } from "../MockAuraApp";
import type { OutgoingDesktopBackground } from "../MockAuraApp/MockAuraApp";
import type { ChatPalette } from "../MockAuraApp/derive-chat-palette";
import styles from "./ComposePanel.module.css";

export interface ComposePanelProps {
  /**
   * Forwarded straight through to `MockAuraApp`. Lets the parent
   * (`PublicChatView`) swap the wallpaper inside the hero frame
   * when the active persona theme supplies a static image,
   * without `ComposePanel` having to know about persona state.
   */
  readonly desktopBackgroundUrl?: string | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Optional looping
   * wallpaper video that replaces the static image when the active
   * persona theme supplies one (`PersonaTheme.desktopBackgroundVideoUrl`).
   */
  readonly desktopBackgroundVideoUrl?: string | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Optional
   * `object-position` for the wallpaper `<img>` (only meaningful
   * when `desktopBackgroundUrl` is set). The parent picks the
   * value from `PersonaTheme.desktopBackgroundPosition`.
   */
  readonly desktopBackgroundPosition?: string | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Optional
   * `object-fit` for the wallpaper `<img>` — `"cover"` (default)
   * or `"contain"`. The parent picks the value from
   * `PersonaTheme.desktopBackgroundFit`.
   */
  readonly desktopBackgroundFit?: "cover" | "contain" | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Optional solid
   * color painted behind the wallpaper `<img>`. The parent picks
   * the value from `PersonaTheme.desktopBackgroundColor`.
   */
  readonly desktopBackgroundColor?: string | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Optional CSS
   * scale multiplier for the wallpaper `<img>`. The parent picks
   * the value from `PersonaTheme.desktopBackgroundScale`.
   */
  readonly desktopBackgroundScale?: number | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Optional vertical
   * translation (in percent of frame height; positive = pull image
   * down) applied AFTER the scale. The parent picks the value from
   * `PersonaTheme.desktopBackgroundOffsetY`.
   */
  readonly desktopBackgroundOffsetY?: number | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Frozen snapshot
   * of the PREVIOUS persona's desktop background, supplied by the
   * parent (`PublicChatView`) while that snapshot dissolves out
   * on top of the current one. Optional so a standalone render
   * of the panel (e.g. isolated tests) just paints the current
   * snapshot without a layered fade.
   */
  readonly outgoingDesktopBackground?: OutgoingDesktopBackground | null;
  /**
   * Forwarded straight through to `MockAuraApp`. The parent
   * (`PublicChatView`) derives this from the active persona's
   * `siteBackgroundColor` via `deriveChatPalette`; this layer
   * stays palette-agnostic so a future host can drop in its own
   * persona swap without touching the panel.
   */
  readonly chatPalette?: ChatPalette | null;
  /**
   * Forwarded straight through to `MockAuraApp` so the bottom-
   * left avatar dock can paint the correct selected border. The
   * panel itself stays persona-agnostic — it just relays whatever
   * the host passes in.
   */
  readonly activePersonaIndex?: number;
  /**
   * Forwarded straight through to `MockAuraApp`. Fires when the
   * visitor clicks an avatar in the dock; the parent
   * (`PublicChatView`) routes this to the same `setActiveIndex`
   * call the right-edge tick rail uses so both surfaces drive a
   * single piece of state.
   */
  readonly onPersonaSelect?: (index: number) => void;
}

/**
 * Empty-state hero stack for the public chat view. Phase 0 reduces
 * this to a thin layout shell that centers the decorative
 * `MockAuraApp` (a flat 16:10 wallpaper rectangle with the scripted
 * DM windows floating inside) in the available empty-state area.
 *
 * The actual `PublicComposeInput` is rendered by `PublicChatView`
 * in its bottom-anchored `.inputBarSlot` (the SAME slot used by the
 * populated transcript layout) so the rounded input pill is pinned
 * to the bottom of the screen in both empty and populated states.
 * That symmetry eliminates any layout jump in the input's vertical
 * position when the visitor sends their first message.
 *
 * Phases 1 and 2 will reintroduce mock chrome on top of the
 * wallpaper (real `ShellTitlebar` overlay plus three bottom dock
 * pills) — none of that lives in this file. The helper-prompt pills
 * that previously sat above a fake taskbar were removed in phase 0
 * along with the rest of the mock chrome.
 */
export function ComposePanel({
  desktopBackgroundUrl = null,
  desktopBackgroundVideoUrl = null,
  desktopBackgroundPosition = null,
  desktopBackgroundFit = null,
  desktopBackgroundColor = null,
  desktopBackgroundScale = null,
  desktopBackgroundOffsetY = null,
  outgoingDesktopBackground = null,
  chatPalette = null,
  activePersonaIndex,
  onPersonaSelect,
}: ComposePanelProps = {}): React.ReactElement {
  return (
    <div
      className={styles.composePanel}
      role="region"
      aria-label="Start a new conversation"
    >
      <MockAuraApp
        desktopBackgroundUrl={desktopBackgroundUrl}
        desktopBackgroundVideoUrl={desktopBackgroundVideoUrl}
        desktopBackgroundPosition={desktopBackgroundPosition}
        desktopBackgroundFit={desktopBackgroundFit}
        desktopBackgroundColor={desktopBackgroundColor}
        desktopBackgroundScale={desktopBackgroundScale}
        desktopBackgroundOffsetY={desktopBackgroundOffsetY}
        outgoingDesktopBackground={outgoingDesktopBackground}
        chatPalette={chatPalette}
        activePersonaIndex={activePersonaIndex}
        onPersonaSelect={onPersonaSelect}
      />
    </div>
  );
}
