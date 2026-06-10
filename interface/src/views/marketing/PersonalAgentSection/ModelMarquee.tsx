import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Anthropic,
  ByteDance,
  DeepSeek,
  Gemini,
  Minimax,
  Moonshot,
  OpenAI,
  Qwen,
  Tripo,
  ZAI,
} from "@lobehub/icons";
import {
  buildMarketingModelEntries,
  type MarketingModelEntry,
} from "../../../constants/models";
import "./ModelMarquee.css";

/**
 * Every model the app ships with — the same catalog that drives the
 * `/models` page, so the strip never drifts out of sync with the
 * actual offering.
 */
const MODELS: readonly MarketingModelEntry[] = buildMarketingModelEntries();

const LOGO_SIZE = 18;

/**
 * How long a clicked model stays lit with the golden accent before
 * settling back — matches the integration-logo pulse in
 * `ServiceDeviceCard` (`pulseLogo(index, 1500)`).
 */
const LIT_MS = 1500;

/**
 * Marketing-provider label -> brand logo. All marks render as the
 * mono variant so they inherit `currentColor` and match the muted
 * gray of the integration glyphs in the service device card
 * (`.personalAgentDeviceLogo`); hovering an item flips them to the
 * glowing golden accent via CSS. Google models (Gemini + Veo) carry
 * the Gemini spark, matching how they're presented in the chat
 * picker.
 */
const PROVIDER_LOGOS: Record<string, ReactNode> = {
  Anthropic: <Anthropic size={LOGO_SIZE} />,
  OpenAI: <OpenAI size={LOGO_SIZE} />,
  "DeepSeek AI": <DeepSeek size={LOGO_SIZE} />,
  "Moonshot AI": <Moonshot size={LOGO_SIZE} />,
  MiniMax: <Minimax size={LOGO_SIZE} />,
  "Z.ai": <ZAI size={LOGO_SIZE} />,
  "Alibaba Cloud": <Qwen size={LOGO_SIZE} />,
  Google: <Gemini size={LOGO_SIZE} />,
  "Tripo AI": <Tripo size={LOGO_SIZE} />,
  ByteDance: <ByteDance size={LOGO_SIZE} />,
};

interface ModelItemsProps {
  /** The duplicate copy is decoration only — hidden from the a11y tree. */
  readonly ariaHidden?: boolean;
  /** Set of model ids currently lit with the gold accent. */
  readonly litIds: ReadonlySet<string>;
  readonly onModelClick: (id: string) => void;
}

function ModelItems({
  ariaHidden = false,
  litIds,
  onModelClick,
}: ModelItemsProps): ReactNode {
  return (
    <div className="modelMarqueeGroup" aria-hidden={ariaHidden || undefined}>
      {MODELS.map((model) => (
        <button
          type="button"
          className="modelMarqueeItem"
          key={model.id}
          tabIndex={ariaHidden ? -1 : undefined}
          data-active={litIds.has(model.id) ? "true" : undefined}
          title={`${model.name} — ${model.provider}`}
          onClick={() => onModelClick(model.id)}
        >
          <span className="modelMarqueeLogo">
            {PROVIDER_LOGOS[model.provider] ?? null}
          </span>
          <span className="modelMarqueeName">{model.name}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Thin looping strip of every model on `/models`, each as a
 * "provider logo + model name" cell. Mounted as its own slim panel at
 * the top of the personal-agent bento, directly above the "Always on."
 * card. The loop mechanism mirrors `AgentMarquee`: the list is
 * rendered twice inside a `width: max-content` track that slides
 * exactly `-50%` per cycle, so the second copy lands where the first
 * started and the drift reads as one continuous band.
 *
 * Hovering anywhere over the panel pauses the drift. Clicking models
 * lights each with the golden accent and holds it for {@link LIT_MS}
 * before settling back — multiple can be lit at once, each with its
 * own independent timer, matching the integration-logo pulse logic in
 * `ServiceDeviceCard`.
 */
export function ModelMarquee(): ReactNode {
  // Set of model ids currently lit, each with its own turn-off timer
  // tracked in `litTimersRef` and keyed by id.
  const [litIds, setLitIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const litTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const pulseModel = useCallback((id: string, durationMs: number) => {
    setLitIds((prev) => {
      if (prev.has(id)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const existing = litTimersRef.current.get(id);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      setLitIds((prev) => {
        if (!prev.has(id)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      litTimersRef.current.delete(id);
    }, durationMs);
    litTimersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    const timers = litTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const handleClick = useCallback(
    (id: string) => pulseModel(id, LIT_MS),
    [pulseModel],
  );

  return (
    <div className="modelMarquee" aria-label="Models available on AURA">
      <div className="modelMarqueeTrack">
        <ModelItems litIds={litIds} onModelClick={handleClick} />
        <ModelItems litIds={litIds} onModelClick={handleClick} ariaHidden />
      </div>
    </div>
  );
}
