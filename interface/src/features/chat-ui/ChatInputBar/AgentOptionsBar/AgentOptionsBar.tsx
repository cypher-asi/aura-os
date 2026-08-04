import { memo, useRef } from "react";
import { createPortal } from "react-dom";
import { Bot, MessagesSquare, Users, Check } from "lucide-react";
import {
  ModelPicker,
  inputBarShellStyles as shell,
} from "../../../../components/InputBarShell";
import { useFlyoutAnchor } from "../../../../components/InputBarShell/use-flyout-anchor";
import type {
  AnswerStrategy,
  CouncilCount,
  CouncilMechanism,
} from "../../../../stores/chat-ui-store";
import styles from "./AgentOptionsBar.module.css";

/** Member counts offered on the council button (`1x` is its own button). */
const COUNCIL_COUNTS: CouncilCount[] = [2, 3, 4];
const FLYOUT_WIDTH = 200;

interface MechanismOption {
  value: CouncilMechanism;
  label: string;
  hint: string;
}

// `members[0]` applies the chosen mechanism once every member finishes.
const MECHANISMS: MechanismOption[] = [
  { value: "synthesize", label: "Synthesize", hint: "one combined answer" },
  { value: "contrast", label: "Contrast", hint: "agreements vs differences" },
  { value: "side_by_side", label: "Side-by-side", hint: "each answer, separate" },
];

export interface AgentOptionsBarProps {
  streamKey: string;
  adapterType?: string;
  defaultModel?: string | null;
  councilCount: CouncilCount;
  councilMechanism: CouncilMechanism;
  answerStrategy: AnswerStrategy;
  setCouncilCount: (streamKey: string, count: CouncilCount) => void;
  setCouncilMechanism: (
    streamKey: string,
    mechanism: CouncilMechanism,
  ) => void;
  setAnswerStrategy: (
    streamKey: string,
    strategy: AnswerStrategy,
    adapterType?: string,
    defaultModel?: string | null,
  ) => void;
}

/**
 * Orchestration options for chat (Code/Plan) modes, rendered as a row of
 * buttons on the line below the chat input: single model (`1x`), Second
 * Opinion, and AURA Council (hover to pick 2–4 members). When council is
 * active a combine-mechanism dropdown appears beside it.
 *
 * These abstract the controls that previously lived inside the model
 * dropdown; they write to the same `chat-ui-store`, which keeps council and
 * second-opinion mutually exclusive, so the send-time payload build is
 * unchanged.
 */
export const AgentOptionsBar = memo(function AgentOptionsBar({
  streamKey,
  adapterType,
  defaultModel,
  councilCount,
  councilMechanism,
  answerStrategy,
  setCouncilCount,
  setCouncilMechanism,
  setAnswerStrategy,
}: AgentOptionsBarProps) {
  const councilActive = councilCount > 1;
  const secondOpinionActive =
    answerStrategy === "second_opinion" && !councilActive;
  const singleActive = !councilActive && !secondOpinionActive;

  const selectSingle = () => {
    // Both are needed to fully return to the single-model path: clear any
    // council fan-out and drop second opinion. The store already treats the
    // two strategies as mutually exclusive.
    setCouncilCount(streamKey, 1);
    setAnswerStrategy(streamKey, "single", adapterType, defaultModel);
  };

  const toggleSecondOpinion = () => {
    setAnswerStrategy(
      streamKey,
      secondOpinionActive ? "single" : "second_opinion",
      adapterType,
      defaultModel,
    );
  };

  // AURA Council member-count hover flyout, anchored to the council button —
  // mirrors the model picker's effort flyout so it escapes the pill's overflow.
  const councilBtnRef = useRef<HTMLButtonElement>(null);
  const { flyoutPos, flyoutStyle, openFlyout, scheduleClose, clearCloseTimer } =
    useFlyoutAnchor(councilBtnRef, { flyoutWidth: FLYOUT_WIDTH });

  const mechanismLabel =
    MECHANISMS.find((m) => m.value === councilMechanism)?.label ?? "Synthesize";

  return (
    <div
      className={styles.bar}
      role="group"
      aria-label="Answer strategy"
      data-agent-surface="agent-options-bar"
    >
      <button
        type="button"
        className={`${styles.option} ${singleActive ? styles.optionActive : ""}`}
        aria-pressed={singleActive}
        data-agent-action="select-single-model"
        title="Single model"
        onClick={selectSingle}
      >
        <Bot size={13} className={styles.optionIcon} />
        <span className={styles.optionLabel}>1x</span>
      </button>

      <button
        type="button"
        className={`${styles.option} ${secondOpinionActive ? styles.optionActive : ""}`}
        aria-pressed={secondOpinionActive}
        data-agent-action="toggle-second-opinion"
        data-second-opinion-active={secondOpinionActive ? "true" : "false"}
        title="Second Opinion — one reference model advises the final answer"
        onClick={toggleSecondOpinion}
      >
        <MessagesSquare size={13} className={styles.optionIcon} />
        <span className={styles.optionLabel}>Second Opinion</span>
      </button>

      <div
        className={styles.councilWrap}
        onMouseEnter={openFlyout}
        onMouseLeave={scheduleClose}
      >
        <button
          ref={councilBtnRef}
          type="button"
          className={`${styles.option} ${councilActive ? styles.optionActive : ""}`}
          aria-pressed={councilActive}
          data-agent-action="open-council-count"
          data-council-count={councilCount}
          title="AURA Council — fan out to multiple models"
          onClick={openFlyout}
        >
          <Users size={13} className={styles.optionIcon} />
          <span className={styles.optionLabel}>AURA Council</span>
          {councilActive ? (
            <span className={styles.optionBadge}>{councilCount}x</span>
          ) : null}
        </button>

        {flyoutPos && typeof document !== "undefined"
          ? createPortal(
              <div
                data-model-menu-root="true"
                className={shell.modelEffortFlyout}
                style={flyoutStyle}
                onMouseEnter={clearCloseTimer}
                onMouseLeave={scheduleClose}
              >
                <div className={shell.modelFlyoutHeader}>
                  <span className={shell.modelFlyoutName}>AURA Council</span>
                  <span className={shell.modelFlyoutMeta}>
                    More models, higher cost
                  </span>
                </div>
                <div className={shell.modelFlyoutEfforts}>
                  {COUNCIL_COUNTS.map((n) => {
                    const selected = n === councilCount;
                    return (
                      <button
                        key={n}
                        type="button"
                        className={`${shell.modelEffortOption} ${selected ? shell.modelEffortOptionActive : ""}`}
                        data-council-count-option={n}
                        onClick={() => setCouncilCount(streamKey, n)}
                      >
                        <span>{`${n}x`}</span>
                        <span className={shell.modelEffortOptionMultiplier}>
                          {`${n} + synth`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>

      {councilActive ? (
        <ModelPicker
          selectedLabel={`Mode: ${mechanismLabel}`}
          renderMenu={(close) => (
            <div
              className={shell.modelMenu}
              data-agent-surface="council-mechanism"
            >
              {MECHANISMS.map((option) => {
                const selected = option.value === councilMechanism;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`${shell.modelMenuItem} ${selected ? shell.modelMenuItemActive : ""}`}
                    data-council-mechanism-option={option.value}
                    aria-pressed={selected}
                    onClick={() => {
                      setCouncilMechanism(streamKey, option.value);
                      close();
                    }}
                  >
                    <span className={shell.councilCountLabel}>
                      <span className={shell.modelMenuItemLabel}>
                        {option.label}
                      </span>
                      <span className={shell.councilCountHint}>
                        {option.hint}
                      </span>
                    </span>
                    <span className={shell.modelMenuItemMeta}>
                      {selected ? (
                        <Check
                          size={13}
                          className={shell.modelMenuItemChevron}
                        />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          triggerProps={{ "data-agent-action": "open-council-mechanism" }}
          className={styles.mechanismPicker}
        />
      ) : null}
    </div>
  );
});
