import { type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { DeviceScreen } from "../../../components/DeviceScreen";
import { AuraScreenOrb } from "../AuraScreenOrb";
import styles from "./AgentConsole.module.css";

/**
 * Decorative "agent device" rendered as the `/agents` hero stage: a tall
 * portrait chassis whose centerpiece is a single raised vertical pill
 * (a mesa standing proud of the surface, ringed by a soft shadow groove).
 * A tall pill-shaped screen is inset into the center of the mesa carrying
 * a living WebGL energy field (`<AuraScreenOrb />`), a row of status
 * lights runs below it, and a large circular
 * control button sits over a split base. Built on the shared marketing
 * device kit (`<Plate />`, `<DeviceScreen />`) so it reads as the same
 * hardware family as the quadrant device below.
 *
 * Everything here is decorative: the whole stage is `aria-hidden` by the
 * consuming view, so the controls are static and non-interactive.
 */

const LIGHTS = [false, false, true, false] as const;

export function AgentConsole(): ReactNode {
  return (
    <div className={styles.console} aria-hidden="true">
      <Plate radius="38px" className={styles.chassis}>
        <div className={styles.content}>
          <span className={styles.logoMark} aria-hidden="true">
            <span />
            <span />
          </span>

          <div className={styles.raised}>
            <DeviceScreen className={styles.screen}>
              <AuraScreenOrb className={styles.screenOrb} />
            </DeviceScreen>
          </div>

          <div className={styles.lights} aria-hidden="true">
            {LIGHTS.map((lit, index) => (
              <span
                key={index}
                className={styles.light}
                data-lit={lit ? "true" : undefined}
              />
            ))}
          </div>

          <div className={styles.button} aria-hidden="true">
            <div className={styles.buttonFace} />
          </div>

          <div className={styles.base} aria-hidden="true" />
        </div>
      </Plate>
    </div>
  );
}
