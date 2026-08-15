import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button, Input, Modal, Spinner, Text } from "@cypher-asi/zui";
import { Circle, MonitorUp, ShieldCheck, Square } from "lucide-react";
import { api } from "../../../api/client";
import {
  desktopApi,
} from "../../../shared/api/desktop";
import type {
  RecordedSkillDraft,
  SkillRecordingFrame,
} from "../../../shared/api/harness-skills";
import { normalizeRecordedSkillName } from "./skill-recorder-utils";
import styles from "./SkillRecorderModal.module.css";

const SKILL_RECORDING_MAX_FRAMES = 12;
const SKILL_RECORDING_INTERVAL_MS = 4_000;
const FIRST_CAPTURE_DELAY_MS = 1_500;
const NAME_RE = /^[a-z0-9-]{1,64}$/;

type RecorderPhase = "setup" | "recording" | "review" | "draft";

interface SkillRecorderModalProps {
  isOpen: boolean;
  agentId: string;
  onClose: () => void;
  onCreated: () => void;
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return fallback;
}

/**
 * Records an ordered, bounded set of local desktop screenshots, then asks a
 * vision model to turn the demonstration into an editable SKILL.md draft.
 */
export function SkillRecorderModal({
  isOpen,
  agentId,
  onClose,
  onCreated,
}: SkillRecorderModalProps) {
  const [phase, setPhase] = useState<RecorderPhase>("setup");
  const [goal, setGoal] = useState("");
  const [notes, setNotes] = useState("");
  const [frames, setFrames] = useState<SkillRecordingFrame[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [draft, setDraft] = useState<RecordedSkillDraft | null>(null);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  const framesRef = useRef<SkillRecordingFrame[]>([]);
  const captureInFlightRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const startedAtRef = useRef(0);
  const firstCaptureRef = useRef<number | null>(null);
  const captureIntervalRef = useRef<number | null>(null);
  const elapsedIntervalRef = useRef<number | null>(null);

  const stopTimers = useCallback(() => {
    if (firstCaptureRef.current != null) {
      window.clearTimeout(firstCaptureRef.current);
      firstCaptureRef.current = null;
    }
    if (captureIntervalRef.current != null) {
      window.clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    if (elapsedIntervalRef.current != null) {
      window.clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
  }, []);

  const finishRecording = useCallback(() => {
    recordingActiveRef.current = false;
    stopTimers();
    setPhase("review");
  }, [stopTimers]);

  const captureFrame = useCallback(async () => {
    if (
      !recordingActiveRef.current ||
      captureInFlightRef.current ||
      framesRef.current.length >= SKILL_RECORDING_MAX_FRAMES
    ) {
      if (framesRef.current.length >= SKILL_RECORDING_MAX_FRAMES) {
        finishRecording();
      }
      return;
    }
    captureInFlightRef.current = true;
    try {
      const screenshot = await desktopApi.captureScreenshot();
      if (!screenshot.ok || !screenshot.image_base64) {
        throw new Error(screenshot.error || "Desktop screenshot failed");
      }
      if (!recordingActiveRef.current) return;
      const next = [
        ...framesRef.current,
        { media_type: "image/png", data: screenshot.image_base64 } as const,
      ];
      framesRef.current = next;
      setFrames(next);
      if (next.length >= SKILL_RECORDING_MAX_FRAMES) finishRecording();
    } catch (cause) {
      if (!recordingActiveRef.current) return;
      setError(
        errorMessage(
          cause,
          "Could not capture the screen. Check Screen Recording permission.",
        ),
      );
      finishRecording();
    } finally {
      captureInFlightRef.current = false;
    }
  }, [finishRecording]);

  const reset = useCallback(() => {
    stopTimers();
    captureInFlightRef.current = false;
    recordingActiveRef.current = false;
    framesRef.current = [];
    setPhase("setup");
    setGoal("");
    setNotes("");
    setFrames([]);
    setElapsedSeconds(0);
    setDraft(null);
    setError("");
    setAnalyzing(false);
    setSaving(false);
    setNameError("");
  }, [stopTimers]);

  useEffect(
    () => () => {
      recordingActiveRef.current = false;
      stopTimers();
    },
    [stopTimers],
  );

  const close = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const startRecording = useCallback(() => {
    if (!goal.trim()) {
      setError("Describe the workflow you are about to demonstrate.");
      return;
    }
    setError("");
    framesRef.current = [];
    setFrames([]);
    setElapsedSeconds(0);
    setPhase("recording");
    recordingActiveRef.current = true;
    startedAtRef.current = Date.now();
    firstCaptureRef.current = window.setTimeout(
      () => void captureFrame(),
      FIRST_CAPTURE_DELAY_MS,
    );
    captureIntervalRef.current = window.setInterval(
      () => void captureFrame(),
      SKILL_RECORDING_INTERVAL_MS,
    );
    elapsedIntervalRef.current = window.setInterval(() => {
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1_000)),
      );
    }, 1_000);
  }, [captureFrame, goal]);

  const analyze = useCallback(async () => {
    if (frames.length === 0) {
      setError("Record at least one screenshot before analyzing.");
      return;
    }
    setAnalyzing(true);
    setError("");
    try {
      const generated = await api.harnessSkills.analyzeRecording({
        goal: goal.trim(),
        notes: notes.trim() || undefined,
        agent_id: agentId,
        frames,
      });
      setDraft({
        ...generated,
        name: normalizeRecordedSkillName(generated.name),
      });
      setPhase("draft");
    } catch (cause) {
      setError(errorMessage(cause, "Failed to analyze the recording."));
    } finally {
      setAnalyzing(false);
    }
  }, [agentId, frames, goal, notes]);

  const save = useCallback(async () => {
    if (!draft) return;
    const name = normalizeRecordedSkillName(draft.name);
    setNameError("");
    setError("");
    if (!NAME_RE.test(name)) {
      setNameError("Use lowercase letters, digits, and hyphens (1-64 chars).");
      return;
    }
    if (!draft.description.trim() || !draft.body.trim()) {
      setError("Description and instructions are required.");
      return;
    }
    setSaving(true);
    try {
      await api.harnessSkills.createSkill({
        name,
        description: draft.description.trim(),
        body: draft.body.trim(),
        agent_id: agentId,
      });
      onCreated();
      close();
    } catch (cause) {
      setError(errorMessage(cause, "Failed to create the recorded skill."));
    } finally {
      setSaving(false);
    }
  }, [agentId, close, draft, onCreated]);

  if (!isOpen) return null;

  if (phase === "recording") {
    return createPortal(
      <div className={styles.recordingHud} role="status">
        <Circle size={10} fill="currentColor" className={styles.recordingDot} />
        <span className={styles.hudLabel}>Recording skill</span>
        <span className={styles.hudMeta}>
          {elapsedSeconds}s · {frames.length}/{SKILL_RECORDING_MAX_FRAMES}
        </span>
        <Button size="sm" variant="ghost" onClick={finishRecording}>
          <Square size={12} fill="currentColor" /> Stop
        </Button>
        <button type="button" className={styles.cancelRecording} onClick={close}>
          Cancel
        </button>
      </div>,
      document.body,
    );
  }

  const footer =
    phase === "setup" ? (
      <div className={styles.footer}>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={startRecording}>
          <Circle size={12} fill="currentColor" /> Start recording
        </Button>
      </div>
    ) : phase === "review" ? (
      <div className={styles.footer}>
        <Button variant="ghost" onClick={startRecording} disabled={analyzing}>
          Retake
        </Button>
        <Button
          variant="primary"
          onClick={() => void analyze()}
          disabled={analyzing || frames.length === 0}
        >
          {analyzing ? <Spinner size="sm" /> : <MonitorUp size={14} />}
          {analyzing ? "Analyzing…" : "Analyze demonstration"}
        </Button>
      </div>
    ) : (
      <div className={styles.footer}>
        <Button variant="ghost" onClick={() => setPhase("review")} disabled={saving}>
          Back
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Spinner size="sm" /> : null}
          {saving ? "Creating…" : "Create & install skill"}
        </Button>
      </div>
    );

  return (
    <Modal
      isOpen
      onClose={close}
      title={phase === "draft" ? "Review recorded skill" : "Record a skill"}
      size="md"
      footer={footer}
    >
      {phase === "setup" ? (
        <div className={styles.body}>
          <div className={styles.privacyNotice}>
            <ShieldCheck size={18} />
            <div>
              <Text size="sm" weight="medium">Private until you analyze</Text>
              <Text size="xs" variant="muted">
                Aura samples your primary display every four seconds. Avoid
                showing secrets. Frames stay on this device until you choose
                Analyze demonstration.
              </Text>
            </div>
          </div>
          <label className={styles.field}>
            <Text size="xs" weight="medium">Workflow goal *</Text>
            <Input
              autoFocus
              value={goal}
              onChange={(event) => {
                setGoal(event.target.value);
                setError("");
              }}
              placeholder="e.g. Publish the weekly product report"
            />
          </label>
          <label className={styles.field}>
            <Text size="xs" weight="medium">Extra context</Text>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="Prerequisites, variable inputs, or what success looks like…"
            />
          </label>
          <Text size="xs" variant="muted">
            The recording stops automatically after {SKILL_RECORDING_MAX_FRAMES} frames
            (about 45 seconds). A small stop control stays above other windows.
          </Text>
        </div>
      ) : phase === "review" ? (
        <div className={styles.body}>
          <Text size="sm">
            Review the {frames.length} captured frame{frames.length === 1 ? "" : "s"}.
            Analyze sends only these frames plus your description to Aura.
          </Text>
          <div className={styles.frameGrid}>
            {frames.map((frame, index) => (
              <figure key={index} className={styles.frame}>
                <img
                  src={`data:${frame.media_type};base64,${frame.data}`}
                  alt={`Recorded workflow frame ${index + 1}`}
                />
                <figcaption>{index + 1}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : draft ? (
        <div className={styles.body}>
          <Text size="xs" variant="muted">
            Edit anything the model inferred before this becomes a real skill.
          </Text>
          <label className={styles.field}>
            <Text size="xs" weight="medium">Name *</Text>
            <Input
              value={draft.name}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
                setNameError("");
              }}
              onBlur={() =>
                setDraft({ ...draft, name: normalizeRecordedSkillName(draft.name) })
              }
              validationMessage={nameError}
            />
          </label>
          <label className={styles.field}>
            <Text size="xs" weight="medium">Description *</Text>
            <Input
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>
          <label className={styles.field}>
            <Text size="xs" weight="medium">Instructions *</Text>
            <textarea
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              rows={14}
              className={styles.instructions}
            />
          </label>
        </div>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </Modal>
  );
}
