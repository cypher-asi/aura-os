import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import { PERSONAS } from "../personas";
import styles from "./PersonaTickRail.module.css";

/**
 * Decorative rail pinned to the far-right edge of the public
 * chat surface (`PublicChatView`). In its resting state the
 * rail shows one fixed-size horizontal tick per entry in
 * `PERSONAS`, stacked top-to-bottom. Every tick paints the same
 * persona-aware foreground color (`--public-nav-fg-color`, fall-
 * back to `--color-text-primary`); only opacity flips between
 * 0.5 (idle) and 1 (active) so the column reads as a single hue
 * at two transparency levels — white-on-dark for video / dark-bg
 * personas, near-black for light-bg personas (Solo Builder,
 * Coordinator).
 *
 * Open / close model
 * ------------------
 * Hovering (or keyboard-focusing) anywhere on the rail flips it
 * into the "open" state — the tick column fades to transparent
 * and a floating panel slides in from the right to *cover* the
 * exact slot the ticks occupied, listing all six personas as
 * clickable rows. Selecting a panel row:
 *
 *   1. notifies the parent via `onActiveIndexChange` so the new
 *      persona's theme takes over immediately, and
 *   2. closes the panel so the visitor is dropped back to the
 *      minimal tick column with their new selection painted as
 *      active.
 *
 * Mouse-out also closes, but on an 80ms debounce so the panel
 * survives the brief gap when the cursor crosses from the tick
 * area onto the panel itself (the panel sits inside the same
 * `.rail` wrapper, but the panel extends visually further left,
 * so a hard mouseleave/enter pair would otherwise flicker the
 * panel closed and immediately re-open it).
 *
 * Direction-aware close: the rail and panel hug the viewport's
 * right edge (`.tickRailSlot` is pinned at `right: 0` and
 * `.panel` is offset `right: -5px` so it lands flush against the
 * viewport). A cursor that leaves rightward toward the screen
 * edge has nothing past the viewport to interact with, so a
 * `mouseleave` whose final `clientX` is at/past the viewport's
 * right edge is treated as a no-op — the menu stays open. Only
 * up / down / left exits (and clicks on a panel row) actually
 * close the menu.
 *
 * Controlled component
 * --------------------
 * The active index is owned by the parent (`PublicChatView`) so
 * the same selection drives both the rail visuals and the
 * page-level theme. The open/close state is local to the rail —
 * no parent needs to know whether the menu is visible.
 */
const CLOSE_DEBOUNCE_MS = 80;

export interface PersonaTickRailProps {
  /** Index into `PERSONAS` that should paint as active. */
  readonly activeIndex: number;
  /**
   * Called when the visitor commits a persona by clicking a
   * panel row (or pressing Enter on a focused tick). The parent
   * is free to persist the change, snap back to a default, or
   * ignore it.
   */
  readonly onActiveIndexChange: (index: number) => void;
}

export function PersonaTickRail({
  activeIndex,
  onActiveIndexChange,
}: PersonaTickRailProps): ReactElement {
  const { t } = useTranslation("publicChat");
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelScheduledClose = (): void => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const open = (): void => {
    cancelScheduledClose();
    setIsOpen(true);
  };

  const scheduleClose = (): void => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DEBOUNCE_MS);
  };

  // Direction-aware mouseleave: skip the close when the cursor
  // exits via the viewport's right edge. The rail+panel are pinned
  // to that edge, so a rightward exit has no other content to
  // interact with — keeping the menu open matches the visitor's
  // intent. Up / down / left exits still schedule the normal 80ms
  // debounced close. The 1px tolerance covers sub-pixel rounding
  // when the cursor leaves the viewport itself.
  const handleMouseLeave = (
    event: ReactMouseEvent<HTMLElement>,
  ): void => {
    if (event.clientX >= window.innerWidth - 1) return;
    scheduleClose();
  };

  const commitSelection = (index: number): void => {
    cancelScheduledClose();
    onActiveIndexChange(index);
    setIsOpen(false);
  };

  useEffect(() => cancelScheduledClose, []);

  return (
    <div
      className={styles.rail}
      data-testid="persona-tick-rail"
      data-panel-open={isOpen ? "true" : "false"}
      onMouseEnter={open}
      onMouseLeave={handleMouseLeave}
    >
      <ul
        className={styles.list}
        aria-label={t("personas.railAriaLabel", {
          defaultValue: "Agent personas",
        })}
      >
        {PERSONAS.map((persona, index) => {
          const isActive = index === activeIndex;
          return (
            <li key={persona.id} className={styles.row}>
              <button
                type="button"
                className={styles.tickButton}
                aria-label={t(`personas.names.${persona.id}`, {
                  defaultValue: persona.name,
                })}
                aria-current={isActive ? "true" : undefined}
                data-active={isActive ? "true" : "false"}
                data-persona-id={persona.id}
                onFocus={open}
                onBlur={scheduleClose}
                onClick={() => commitSelection(index)}
              >
                <span className={styles.tick} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <div
        className={styles.panel}
        data-testid="persona-tick-rail-panel"
        aria-hidden={isOpen ? undefined : "true"}
        onMouseEnter={open}
        onMouseLeave={handleMouseLeave}
      >
        <ul className={styles.panelList}>
          {PERSONAS.map((persona, index) => (
            <li key={persona.id} className={styles.panelRow}>
              <button
                type="button"
                className={styles.panelItem}
                data-active={index === activeIndex ? "true" : "false"}
                data-persona-id={persona.id}
                tabIndex={isOpen ? 0 : -1}
                onClick={() => commitSelection(index)}
              >
                {t(`personas.names.${persona.id}`, {
                  defaultValue: persona.name,
                })}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
