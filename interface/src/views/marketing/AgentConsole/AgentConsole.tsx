import { type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { DeviceScreen } from "../../../components/DeviceScreen";
import { DeviceLabelStrip } from "../../../components/DeviceLabelStrip";
import { DotMatrixGrille } from "../../../components/DotMatrixGrille";
import { HardwareKey } from "../../../components/HardwareKey";
import styles from "./AgentConsole.module.css";

/**
 * Decorative "agent console" rendered as the `/agents` hero stage: a
 * black hardware configurator panel recreated from the shared marketing
 * device kit so it reads as the same hardware family as the "An agent
 * designed for you" quadrant below. The chassis is a `<Plate />`, the
 * CRT a `<DeviceScreen />`, the control banks `<HardwareKey />`s, and
 * the speaker a `<DotMatrixGrille />`.
 *
 * Everything here is decorative: the whole stage is `aria-hidden` by the
 * consuming view, and the keys carry hover/press affordances only.
 */

interface ConsoleKey {
  readonly text: string;
  readonly lit?: boolean;
}

interface ControlGroup {
  readonly label: string;
  readonly keys: readonly [ConsoleKey, ConsoleKey];
}

const LEFT_GROUPS: readonly ControlGroup[] = [
  { label: "Model", keys: [{ text: "PIN" }, { text: "CYCLE", lit: true }] },
  { label: "Persona", keys: [{ text: "EDIT" }, { text: "SHUFFLE", lit: true }] },
  { label: "Tools", keys: [{ text: "CLEAR" }, { text: "ADD", lit: true }] },
  { label: "Memory", keys: [{ text: "WIPE" }, { text: "SYNC", lit: true }] },
];

const RIGHT_GROUPS: readonly ControlGroup[] = [
  { label: "Voice", keys: [{ text: "MUTE" }, { text: "CYCLE", lit: true }] },
  { label: "Privacy", keys: [{ text: "AUDIT" }, { text: "LOCK", lit: true }] },
  { label: "Compute", keys: [{ text: "RESET" }, { text: "SCALE", lit: true }] },
];

function ControlGroupView({ group }: { group: ControlGroup }): ReactNode {
  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>{group.label}</span>
      <div className={styles.keys}>
        {group.keys.map((key) => (
          <HardwareKey key={key.text} label={key.text} lit={key.lit} />
        ))}
      </div>
    </div>
  );
}

export function AgentConsole(): ReactNode {
  return (
    <div className={styles.console} aria-hidden="true">
      <Plate radius="24px" className={styles.chassis}>
        <div className={styles.content}>
          <header className={styles.header}>
            <span className={styles.rule} />
            <div className={styles.wordmark}>
              <span className={styles.wordmarkText}>AURA</span>
              <span className={styles.wordmarkSub}>AGENT CONSOLE 5000</span>
            </div>
            <span className={styles.rule} />
            <div className={styles.knob}>
              <div className={styles.knobDial} />
              <span className={styles.knobLabel}>ON / OFF</span>
            </div>
          </header>

          <div className={styles.body}>
            <div className={styles.column}>
              {LEFT_GROUPS.map((group) => (
                <ControlGroupView key={group.label} group={group} />
              ))}
            </div>

            <div className={styles.screenWrap}>
              <DeviceScreen className={styles.screen}>
                <div className={styles.screenGlow} />
                <div className={styles.scanlines} />
              </DeviceScreen>
              <div className={styles.transport}>
                <span />
                <span />
                <span />
              </div>
            </div>

            <div className={styles.column}>
              {RIGHT_GROUPS.map((group) => (
                <ControlGroupView key={group.label} group={group} />
              ))}
            </div>
          </div>

          <DeviceLabelStrip
            label="PRIVATE BY DESIGN"
            className={styles.labelStrip}
          />

          <footer className={styles.footer}>
            <div className={styles.brands}>
              <span className={styles.brandMark}>AURA</span>
              <span className={styles.brandMarkAlt}>v1.0</span>
            </div>
            <div className={styles.slider}>
              <div className={styles.sliderKnob} />
              <span className={styles.sliderLabel}>SLIDE TO DEPLOY</span>
            </div>
            <DotMatrixGrille height="46px" className={styles.speaker} />
          </footer>
        </div>
      </Plate>
    </div>
  );
}
