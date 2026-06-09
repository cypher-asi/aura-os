import { type ReactNode } from "react";
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
}

function ModelItems({ ariaHidden = false }: ModelItemsProps): ReactNode {
  return (
    <div className="modelMarqueeGroup" aria-hidden={ariaHidden || undefined}>
      {MODELS.map((model) => (
        <span
          className="modelMarqueeItem"
          key={model.id}
          title={`${model.name} — ${model.provider}`}
        >
          <span className="modelMarqueeLogo">
            {PROVIDER_LOGOS[model.provider] ?? null}
          </span>
          <span className="modelMarqueeName">{model.name}</span>
        </span>
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
 */
export function ModelMarquee(): ReactNode {
  return (
    <div className="modelMarquee" aria-label="Models available on AURA">
      <div className="modelMarqueeTrack">
        <ModelItems />
        <ModelItems ariaHidden />
      </div>
    </div>
  );
}
