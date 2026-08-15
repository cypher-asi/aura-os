import { Modal, Spinner } from "@cypher-asi/zui";
import { SegmentedContent } from "../../../components/SegmentedContent/SegmentedContent";
import styles from "./AsideModal.module.css";

interface AsideModalProps {
  question: string;
  answer?: string;
  error?: string;
  onClose: () => void;
}

/** A one-response overlay whose contents never join the main transcript. */
export function AsideModal({
  question,
  answer,
  error,
  onClose,
}: AsideModalProps) {
  const loading = answer == null && error == null;
  return (
    <Modal isOpen onClose={onClose} title="Quick aside" size="md">
      <div className={styles.body}>
        <p className={styles.ephemeral}>Not saved to this chat</p>
        <div className={styles.question}>
          <span className={styles.label}>You asked</span>
          <p>{question}</p>
        </div>
        <div className={styles.answer} aria-live="polite">
          {loading ? (
            <div className={styles.loading} role="status">
              <Spinner size="sm" />
              <span>Answering from the current conversation…</span>
            </div>
          ) : error ? (
            <p className={styles.error} role="alert">{error}</p>
          ) : (
            <SegmentedContent content={answer ?? ""} />
          )}
        </div>
      </div>
    </Modal>
  );
}
