import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Button, Input, Modal, Text } from "@cypher-asi/zui";
import { Select } from "../../../components/Select";
import { useModalInitialFocus } from "../../../hooks/use-modal-initial-focus";
import { useFeedbackStore } from "../../../stores/feedback-store";
import {
  DEFAULT_FEEDBACK_PRODUCT,
  FEEDBACK_CATEGORY_OPTIONS,
  FEEDBACK_PRODUCT_OPTIONS,
  FEEDBACK_STATUS_OPTIONS,
  type FeedbackCategory,
  type FeedbackProduct,
  type FeedbackStatus,
} from "../types";
import styles from "./NewFeedbackModal.module.css";

function isFeedbackProduct(value: string): value is FeedbackProduct {
  return FEEDBACK_PRODUCT_OPTIONS.some((option) => option.value === value);
}

function isFeedbackCategory(value: string): value is FeedbackCategory {
  return FEEDBACK_CATEGORY_OPTIONS.some((option) => option.value === value);
}

function isFeedbackStatus(value: string): value is FeedbackStatus {
  return FEEDBACK_STATUS_OPTIONS.some((option) => option.value === value);
}

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

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>(DEFAULT_CATEGORY);
  const [status, setStatus] = useState<FeedbackStatus>(DEFAULT_STATUS);
  // Composer always defaults to AURA regardless of the current Product filter.
  // Users pick a different product explicitly via the Product select.
  const [product, setProduct] = useState<FeedbackProduct>(
    DEFAULT_FEEDBACK_PRODUCT,
  );

  useEffect(() => {
    if (!isOpen) {
      setTitle("");
      setBody("");
      setCategory(DEFAULT_CATEGORY);
      setStatus(DEFAULT_STATUS);
      setProduct(DEFAULT_FEEDBACK_PRODUCT);
      resetComposerError();
    }
  }, [isOpen, resetComposerError]);

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

  // ZUI's Modal re-runs its focus effect whenever `onClose`'s identity
  // changes, so stabilize this callback — otherwise every keystroke
  // triggers a re-render and yanks the cursor back to the title input.
  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  const handleBodyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
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
              onChange={(v) => {
                if (isFeedbackProduct(v)) setProduct(v);
              }}
              options={[...FEEDBACK_PRODUCT_OPTIONS]}
            />
          </div>
          <div className={styles.selectLabel}>
            <span className={styles.selectLabelText}>Category</span>
            <Select
              value={category}
              onChange={(v) => {
                if (isFeedbackCategory(v)) setCategory(v);
              }}
              options={[...FEEDBACK_CATEGORY_OPTIONS]}
            />
          </div>
          <div className={styles.selectLabel}>
            <span className={styles.selectLabelText}>Status</span>
            <Select
              value={status}
              onChange={(v) => {
                if (isFeedbackStatus(v)) setStatus(v);
              }}
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
