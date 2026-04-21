import type { DebugRunMetadata } from "../../../api/debug";
import styles from "./DebugRunDetailView.module.css";

interface Props {
  metadata: DebugRunMetadata | undefined;
}

/**
 * Compact row of counters rendered above the log timeline. Pulls all
 * values from the run's metadata bundle so the component can be
 * rendered even when the current channel is still loading.
 */
export function DebugRunCounters({ metadata }: Props) {
  if (!metadata) return null;
  const c = metadata.counters;
  return (
    <div className={styles.counters}>
      <span className={styles.counter}>
        events <span className={styles.counterValue}>{c.events_total}</span>
      </span>
      <span className={styles.counter}>
        llm <span className={styles.counterValue}>{c.llm_calls}</span>
      </span>
      <span className={styles.counter}>
        iter <span className={styles.counterValue}>{c.iterations}</span>
      </span>
      <span className={styles.counter}>
        blockers <span className={styles.counterValue}>{c.blockers}</span>
      </span>
      <span className={styles.counter}>
        retries <span className={styles.counterValue}>{c.retries}</span>
      </span>
      <span className={styles.counter}>
        tools <span className={styles.counterValue}>{c.tool_calls}</span>
      </span>
      <span className={styles.counter}>
        tokens{" "}
        <span className={styles.counterValue}>
          {c.input_tokens}→{c.output_tokens}
        </span>
      </span>
      <span className={styles.counter}>
        tasks{" "}
        <span className={styles.counterValue}>
          {c.task_completed}/{c.task_completed + c.task_failed}
        </span>
      </span>
    </div>
  );
}
