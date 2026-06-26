import { Modal } from "@cypher-asi/zui";
import { ChangelogView } from "../../views/marketing/ChangelogView";
import styles from "./ChangelogModal.module.css";

export function ChangelogModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Changelog"
      size="xl"
      fullHeight
      className={styles.wideModal}
    >
      <ChangelogView embedded />
    </Modal>
  );
}
