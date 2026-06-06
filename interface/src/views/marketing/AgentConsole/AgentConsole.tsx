import { type ReactNode } from "react";
import { Headphones, Mic, Shuffle } from "lucide-react";
import { Plate } from "../../../components/Plate";
import { DeviceScreen } from "../../../components/DeviceScreen";
import { DeviceLabelStrip } from "../../../components/DeviceLabelStrip";
import { DotMatrixGrille } from "../../../components/DotMatrixGrille";
import { HardwareKey } from "../../../components/HardwareKey";
import { Knob } from "../../../components/Knob";
import styles from "./AgentConsole.module.css";

/**
 * Decorative "agent composer" rendered as the `/agents` hero stage: a
 * tall black sampler-style device recreated from the shared marketing
 * device kit so it reads as the same hardware family as the "An agent
 * designed for you" quadrant below. Top to bottom: a recessed
 * `<DeviceScreen />`, a `<DeviceLabelStrip />`, a `<DotMatrixGrille />`
 * speaker, then a two-column control deck (a fader + square `HardwareKey`
 * grid on the left; `Knob`s + labeled `HardwareKey` button rows on the
 * right) and a pair of partial dials at the foot.
 *
 * Everything here is decorative: the whole stage is `aria-hidden` by the
 * consuming view, and the controls carry hover/press affordances only.
 */

interface DeckKey {
  readonly text: string;
  readonly lit?: boolean;
}

const GRID_KEYS: readonly DeckKey[] = [
  { text: "A" },
  { text: "TEMPO" },
  { text: "B", lit: true },
  { text: "C" },
  { text: "D" },
  { text: "E" },
];

interface DeckButton {
  readonly text: string;
  readonly sub: string;
  readonly lit?: boolean;
}

const BUTTON_ROW_ONE: readonly DeckButton[] = [
  { text: "FX", sub: "OUTPUT" },
  { text: "SAMPLE", sub: "CHOP", lit: true },
  { text: "TIMING", sub: "CORRECT" },
];

const BUTTON_ROW_TWO: readonly DeckButton[] = [
  { text: "ERASE", sub: "SYSTEM" },
  { text: "RECORD", sub: "TAKE", lit: true },
  { text: "PLAY", sub: "LOOP" },
];

function DeckButtonView({ button }: { button: DeckButton }): ReactNode {
  return (
    <div className={styles.btnCol}>
      <HardwareKey label={button.text} lit={button.lit} className={styles.deckKey} />
      <span className={styles.btnSub}>{button.sub}</span>
    </div>
  );
}

export function AgentConsole(): ReactNode {
  return (
    <div className={styles.console} aria-hidden="true">
      <Plate radius="28px" className={styles.chassis}>
        <div className={styles.content}>
          <DeviceScreen className={styles.screen}>
            <div className={styles.screenStatus}>
              <Shuffle size={15} strokeWidth={2} />
              <Mic size={15} strokeWidth={2} />
              <Headphones size={15} strokeWidth={2} />
            </div>
          </DeviceScreen>

          <DeviceLabelStrip
            label="AURA AGENT COMPOSER"
            className={styles.labelStrip}
          />

          <DotMatrixGrille height="118px" className={styles.speaker} />

          <div className={styles.deck}>
            <div className={styles.deckLeft}>
              <div className={styles.fader}>
                <div className={styles.faderTrack}>
                  <div className={styles.faderKnob} />
                </div>
                <HardwareKey label="SHIFT" className={styles.shiftKey} />
              </div>
              <div className={styles.keyGrid}>
                {GRID_KEYS.map((key) => (
                  <HardwareKey
                    key={key.text}
                    label={key.text}
                    lit={key.lit}
                    className={styles.gridKey}
                  />
                ))}
              </div>
            </div>

            <span className={styles.deckDivider} />

            <div className={styles.deckRight}>
              <div className={styles.knobs}>
                <Knob label="VOLUME" variant="light" angle={-38} size="52px" />
                <Knob label="BPM" variant="accent" angle={22} size="52px" />
                <Knob label="METRONOME" variant="dark" angle={-12} size="52px" />
              </div>
              <div className={styles.btnRow}>
                {BUTTON_ROW_ONE.map((button) => (
                  <DeckButtonView key={button.text} button={button} />
                ))}
              </div>
              <div className={styles.btnRow}>
                {BUTTON_ROW_TWO.map((button) => (
                  <DeckButtonView key={button.text} button={button} />
                ))}
              </div>
            </div>
          </div>

          <div className={styles.bottomDials}>
            <span className={styles.bottomMark}>&#10033;</span>
            <Knob variant="dark" angle={-30} size="74px" ticks={false} />
            <Knob variant="dark" angle={40} size="74px" ticks={false} />
            <span className={styles.bottomMark}>&#10033;</span>
          </div>
        </div>
      </Plate>
    </div>
  );
}
