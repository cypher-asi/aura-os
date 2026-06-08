import { type ReactNode, useState } from "react";
import { Plate } from "../../../components/Plate";
import { DeviceScreen } from "../../../components/DeviceScreen";
import { AuraScreenOrb } from "../AuraScreenOrb";
import styles from "./AgentConsole.module.css";

/**
 * Interactive "agent device" rendered as the `/agents` hero stage: a tall
 * portrait chassis whose centerpiece is a single raised vertical pill
 * (a mesa standing proud of the surface, ringed by a soft shadow groove).
 * A tall pill-shaped screen is inset into the center of the mesa carrying
 * a living WebGL energy field (`<AuraScreenOrb />`) with the active state
 * name overlaid on top. A row of status lights runs below it, and a large
 * circular control cap sits over a split base whose two halves are real
 * left/right buttons (like big mouse buttons). Built on the shared
 * marketing device kit (`<Plate />`, `<DeviceScreen />`) so it reads as the
 * same hardware family as the quadrant device below.
 *
 * The left button steps the lit light (and label) one state back, the right
 * one steps it forward, wrapping at the ends so exactly one light is lit at
 * a time. The WebGL field itself stays decorative/ambient.
 */

/**
 * The cycle of states, one per status light. The lit light's index selects
 * both which dot glows and which label is painted over the screen.
 */
const STATES = ["Private", "Secure", "Verifiable", "Open Source"] as const;

export function AgentConsole(): ReactNode {
  const [active, setActive] = useState(0);

  const step = (delta: number) =>
    setActive((i) => (i + delta + STATES.length) % STATES.length);

  return (
    <div className={styles.console}>
      <Plate radius="38px" className={styles.chassis}>
        <div className={styles.content}>
          <span className={styles.logoMark} aria-hidden="true">
            <span />
            <span />
          </span>

          <div className={styles.raised}>
            <DeviceScreen className={styles.screen}>
              <AuraScreenOrb className={styles.screenOrb} />
              <span className={styles.screenLabel}>{STATES[active]}</span>
            </DeviceScreen>
          </div>

          <div className={styles.lights} aria-hidden="true">
            {STATES.map((state, index) => (
              <span
                key={state}
                className={styles.light}
                data-lit={index === active ? "true" : undefined}
              />
            ))}
          </div>

          <div className={styles.button} aria-hidden="true">
            <div className={styles.buttonFace} />
          </div>

          <div className={styles.base}>
            <button
              type="button"
              className={styles.baseButton}
              aria-label="Previous"
              onClick={() => step(-1)}
            />
            <button
              type="button"
              className={`${styles.baseButton} ${styles.baseButtonRight}`}
              aria-label="Next"
              onClick={() => step(1)}
            />
          </div>
        </div>
      </Plate>
    </div>
  );
}
