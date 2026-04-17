import { useEffect, useState } from "react";
import { Button, Input, Modal, Text } from "@cypher-asi/zui";
import { Select } from "../../../components/Select";
import { useModalInitialFocus } from "../../../hooks/use-modal-initial-focus";
import { useFeedbackStore } from "../../../stores/feedback-store";
import {
  FEEDBACK_CATEGORY_OPTIONS,
  FEEDBACK_PRODUCT_OPTIONS,
  FEEDBACK_STATUS_OPTIONS,
  type FeedbackCategory,
  type FeedbackProduct,
  type FeedbackStatus,
} from "../types";
import styles from "./NewFeedbackModal.module.css";

export interface NewFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_CATEGORY: FeedbackCategory = "feature_request";
const DEFAULT_STATUS: FeedbackStatus = "not_started";

export function NewFeedbackModal({ isOpen, onClose }: NewFeedbackModalProps) {
  const { inputRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();
  const createFeedback = useFeedbackStore((s) => s.createFeedback);
  const isSubmitting = useFeedbackStore((s) => s.isSubmitting);
  const composerError = useFeedbackStore((s) => s.composerError);
  const resetComposerError = useFeedbackStore((s) => s.resetComposerError);
  // The composer's product follows the current filter so posting from inside
  // the Grid view (for example) tags the new item as Grid without a click.
  const productFilter = useFeedbackStore((s) => s.productFilter);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>(DEFAULT_CATEGORY);
  const [status, setStatus] = useState<FeedbackStatus>(DEFAULT_STATUS);
  const [product, setProduct] = useState<FeedbackProduct>(productFilter);

  useEffect(() => {
    if (!isOpen) {
      setTitle("");
      setBody("");
      setCategory(DEFAULT_CATEGORY);
      setStatus(DEFAULT_STATUS);
      setProduct(productFilter);
      resetComposerError();
    } else {
      // Re-seed from the filter whenever the modal opens, so switching
      // products between post attempts is reflected immediately.
      setProduct(productFilter);
    }
  }, [isOpen, productFilter, resetComposerError]);

  const canSubmit = body.trim().length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const created = await createFeedback({
      title,
      body,
      category,
      status,
      product,
    });
    if (created) onClose();
  };

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleBodyChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(event.target.value);
    if (composerError) resetComposerError();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Feedback"
      size="md"
      initialFocusRef={initialFocusRef}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isSubmitting ? "Posting..." : "Post"}
          </Button>
        </>
      }
    >
      <div className={styles.formColumn}>
        <Input
          ref={inputRef}
          value={title}
          placeholder="Title (optional)"
          aria-label="Feedback title"
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className={styles.fieldGroup}>
          <Text size="sm" className={styles.fieldLabel}>Feedback</Text>
          <textarea
            className={styles.bodyInput}
            value={body}
            placeholder="What's on your mind?"
            aria-label="Feedback body"
            rows={5}
            onChange={handleBodyChange}
          />
        </div>
        <div className={styles.selectsRow}>
          <div className={styles.selectLabel}>
            <span className={styles.selectLabelText}>Product</span>
            <Select
              value={product}
              onChange={(v) => setProduct(v as FeedbackProduct)}
              options={[...FEEDBACK_PRODUCT_OPTIONS]}
            />
          </div>
          <div className={styles.selectLabel}>
            <span className={styles.selectLabelText}>Category</span>
            <Select
              value={category}
              onChange={(v) => setCategory(v as FeedbackCategory)}
              options={[...FEEDBACK_CATEGORY_OPTIONS]}
            />
          </div>
          <div className={styles.selectLabel}>
            <span className={styles.selectLabelText}>Status</span>
            <Select
              value={status}
              onChange={(v) => setStatus(v as FeedbackStatus)}
              options={[...FEEDBACK_STATUS_OPTIONS]}
            />
          </div>
        </div>
        {composerError ? (
          <Text size="sm" className={styles.errorText} role="alert">
            {composerError}
          </Text>
        ) : null}
      </div>
    </Modal>
  );
}
