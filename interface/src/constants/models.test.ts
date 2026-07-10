import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AURA_MANAGED_CHAT_MODELS,
  availableModelsForAdapter,
  effectiveCreditMultiplier,
  effortCreditFactor,
  getModelsForMode,
  hasAgentScopedModel,
  loadPersistedImageModel,
  loadPersistedModel,
  loadPersistedModelForMode,
  loadPersistedThreeDModel,
  loadPersistedVideoModel,
  persistModel,
  type ModelOption,
} from "./models";

describe("model persistence", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
      setItem: vi.fn((key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const k of Object.keys(store)) delete store[k];
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persistModel writes both an agent-scoped and adapter-scoped key", () => {
    persistModel("aura-claude-sonnet-4-6", "default", "agent-1");
    expect(store["aura-selected-model:agent:agent-1"]).toBe(
      "aura-claude-sonnet-4-6",
    );
    expect(store["aura-selected-model:default"]).toBe("aura-claude-sonnet-4-6");
  });

  it("persistModel without agentId only writes adapter key", () => {
    persistModel("aura-claude-opus-4-6", "default");
    expect(Object.keys(store)).toEqual(["aura-selected-model:default"]);
    expect(store["aura-selected-model:default"]).toBe("aura-claude-opus-4-6");
  });

  it("loadPersistedModel prefers the agent-scoped key over the adapter key", () => {
    persistModel("aura-claude-opus-4-6", "default");
    persistModel("aura-gpt-5-4", "default", "agent-a");
    expect(loadPersistedModel("default", null, "agent-a")).toBe("aura-gpt-5-4");
  });

  it("loadPersistedModel falls back to the user's most recent pick for an untouched agent", () => {
    // `persistModel` writes the adapter-scoped key as a side effect of
    // every selection, capturing "the last model the user picked
    // anywhere". A brand-new agent with no per-agent key opens with
    // that global pick rather than reverting to the adapter default,
    // so users don't have to re-select their preferred model on every
    // fresh chat.
    persistModel("aura-gpt-5-4", "default", "agent-a");
    expect(loadPersistedModel("default", null, "new-agent")).toBe(
      "aura-gpt-5-4",
    );
  });

  it("loadPersistedModel returns the adapter default when neither key is set", () => {
    expect(loadPersistedModel("default", null, "new-agent")).toBe(
      "aura-claude-sonnet-5",
    );
    expect(loadPersistedModel("default", null)).toBe("aura-claude-sonnet-5");
  });

  it("loadPersistedModel prefers the per-agent key over the global fallback", () => {
    // Global pick is GPT-5.4 (from agent-a's last selection) but
    // agent-b has its own remembered Sonnet pick — agent-b must get
    // Sonnet, not the global GPT-5.4 fallback.
    persistModel("aura-gpt-5-4", "default", "agent-a");
    persistModel("aura-claude-sonnet-4-6", "default", "agent-b");
    expect(loadPersistedModel("default", null, "agent-b")).toBe(
      "aura-claude-sonnet-4-6",
    );
  });

  it("loadPersistedModel uses the adapter-scoped key when no agentId is supplied", () => {
    persistModel("aura-claude-opus-4-6", "default");
    expect(loadPersistedModel("default", null)).toBe("aura-claude-opus-4-6");
  });

  it("hasAgentScopedModel detects whether an agent has a remembered model", () => {
    expect(hasAgentScopedModel("agent-a")).toBe(false);
    persistModel("aura-claude-sonnet-4-6", "default", "agent-a");
    expect(hasAgentScopedModel("agent-a")).toBe(true);
    expect(hasAgentScopedModel("agent-b")).toBe(false);
  });

  it("different agents keep independent remembered models", () => {
    persistModel("aura-claude-sonnet-4-6", "default", "agent-a");
    persistModel("aura-gpt-5-4-mini", "default", "agent-b");
    expect(loadPersistedModel("default", null, "agent-a")).toBe(
      "aura-claude-sonnet-4-6",
    );
    expect(loadPersistedModel("default", null, "agent-b")).toBe(
      "aura-gpt-5-4-mini",
    );
  });

  it("normalizes raw GPT-5.5 to the Aura-managed chat model", () => {
    expect(loadPersistedModel("default", "gpt-5.5")).toBe("aura-gpt-5-5");
  });

  it("normalizes the GPT-5.6 family to Aura-managed chat models", () => {
    expect(loadPersistedModel("default", "gpt-5.6")).toBe("aura-gpt-5-6-sol");
    expect(loadPersistedModel("default", "gpt-5.6-sol")).toBe("aura-gpt-5-6-sol");
    expect(loadPersistedModel("default", "gpt-5.6-terra")).toBe(
      "aura-gpt-5-6-terra",
    );
    expect(loadPersistedModel("default", "gpt-5.6-luna")).toBe(
      "aura-gpt-5-6-luna",
    );
  });

  it("normalizes raw Grok model ids to Aura-managed chat models", () => {
    expect(loadPersistedModel("default", "grok-4.5")).toBe("aura-grok-4-5");
    expect(loadPersistedModel("default", "grok-4.3")).toBe("aura-grok-4-3");
    expect(loadPersistedModel("default", "grok-build-0.1")).toBe(
      "aura-grok-build-0-1",
    );
    expect(loadPersistedModel("default", "grok-code-fast-1")).toBe(
      "aura-grok-build-0-1",
    );
  });

  it("normalizes raw Claude Fable 5 to the Aura-managed chat model", () => {
    expect(loadPersistedModel("default", "claude-fable-5")).toBe(
      "aura-claude-fable-5",
    );
  });

  it("includes Claude Fable 5 in the Anthropic chat model list", () => {
    const fable = availableModelsForAdapter("default").find(
      (model) => model.id === "aura-claude-fable-5",
    );

    expect(fable).toMatchObject({
      label: "Fable 5",
      vendor: "anthropic",
      creditMultiplier: 10,
      contextWindow: 1_000_000,
    });
    expect(fable?.efforts).toBeUndefined();
    expect(fable?.defaultEffort).toBeUndefined();
  });

  it("restores a persisted Claude Fable 5 selection now that it is available", () => {
    store["aura-selected-model:agent:agent-fable"] = "aura-claude-fable-5";
    store["aura-selected-model:default"] = "aura-claude-fable-5";

    expect(loadPersistedModel("default", null, "agent-fable")).toBe(
      "aura-claude-fable-5",
    );
  });

  it("keeps image models out of the chat adapter model list", () => {
    expect(availableModelsForAdapter("default").map((m) => m.id)).not.toContain(
      "gpt-image-2",
    );
    expect(getModelsForMode("image").map((m) => m.id)).toContain("gpt-image-2");
  });

  it("ignores persisted image models for chat defaults", () => {
    persistModel("gpt-image-2", "default", "agent-image");
    expect(loadPersistedModel("default", null, "agent-image")).not.toBe(
      "gpt-image-2",
    );
    expect(loadPersistedModel("default", null, "agent-image")).toBe(
      "aura-claude-sonnet-5",
    );
  });

  it("ignores a stored agent value that isn't a known model", () => {
    persistModel("not-a-real-model", "default", "agent-bogus");
    // An invalid model id stored under the agent-scoped key should be
    // ignored and `loadPersistedModel` should fall through to the
    // adapter default.
    expect(loadPersistedModel("default", null, "agent-bogus")).not.toBe(
      "not-a-real-model",
    );
  });

  describe("per-mode persistence", () => {
    it("video picks write to the video namespace, not the chat keys", () => {
      persistModel("dreamina-seedance-2-0-260128", "default", "agent-A");
      expect(store["aura-selected-model:video:agent:agent-A"]).toBe(
        "dreamina-seedance-2-0-260128",
      );
      expect(store["aura-selected-model:video:default"]).toBe(
        "dreamina-seedance-2-0-260128",
      );
      // Critical: the chat keys must remain untouched so a subsequent
      // chat-mode reopen can still restore the user's last chat pick.
      expect(store["aura-selected-model:agent:agent-A"]).toBeUndefined();
      expect(store["aura-selected-model:default"]).toBeUndefined();
    });

    it("3D picks write to the 3D namespace, not the chat keys", () => {
      persistModel("tripo-v2", "default", "agent-A");
      expect(store["aura-selected-model:3d:agent:agent-A"]).toBe("tripo-v2");
      expect(store["aura-selected-model:3d:default"]).toBe("tripo-v2");
      expect(store["aura-selected-model:agent:agent-A"]).toBeUndefined();
      expect(store["aura-selected-model:default"]).toBeUndefined();
    });

    it("image picks write to the image namespace and update the global key", () => {
      persistModel("gpt-image-1", "default", "agent-A");
      expect(store["aura-selected-model:image:agent:agent-A"]).toBe(
        "gpt-image-1",
      );
      expect(store["aura-selected-model:image:default"]).toBe("gpt-image-1");
      // Chat keys must remain untouched.
      expect(store["aura-selected-model:agent:agent-A"]).toBeUndefined();
      expect(store["aura-selected-model:default"]).toBeUndefined();
    });

    it("a chat pick after a video pick does not lose the video pick", () => {
      // Pick Seedance in video mode...
      persistModel("dreamina-seedance-2-0-260128", "default", "agent-A");
      // ...then switch to chat mode and pick GPT-5.5.
      persistModel("aura-gpt-5-5", "default", "agent-A");

      // Both buckets remember their own last pick.
      expect(loadPersistedVideoModel("agent-A")).toBe(
        "dreamina-seedance-2-0-260128",
      );
      expect(loadPersistedModel("default", null, "agent-A")).toBe(
        "aura-gpt-5-5",
      );
    });

    it("loadPersistedVideoModel falls back to the global key for untouched agents", () => {
      persistModel("dreamina-seedance-2-0-260128", "default", "agent-A");
      // agent-B has no per-agent video key but should still inherit the
      // global last-video pick.
      expect(loadPersistedVideoModel("agent-B")).toBe(
        "dreamina-seedance-2-0-260128",
      );
    });

    it("loadPersistedThreeDModel falls back to the 3D default when nothing is stored", () => {
      expect(loadPersistedThreeDModel("agent-A")).toBe("tripo-v2");
    });

    it("loadPersistedImageModel inherits the global last-image pick on a new agent", () => {
      // The new global write inside `persistModel` lets a brand-new
      // agent pick up the user's last image-mode choice instead of
      // always reverting to the IMAGE_MODELS[0] default.
      persistModel("gemini-nano-banana", "default", "agent-A");
      expect(loadPersistedImageModel("agent-B")).toBe("gemini-nano-banana");
    });

    it("loadPersistedImageModel ignores stale DALL-E selections while unavailable", () => {
      store["aura-selected-model:image:agent:agent-A"] = "dall-e-3";
      store["aura-selected-model:image:default"] = "dall-e-2";

      expect(loadPersistedImageModel("agent-A")).toBe("gpt-image-2");
    });

    it("loadPersistedModelForMode dispatches to the right loader", () => {
      persistModel("aura-gpt-5-5", "default", "agent-A");
      persistModel("gemini-nano-banana", "default", "agent-A");
      persistModel("dreamina-seedance-2-0-260128", "default", "agent-A");

      expect(loadPersistedModelForMode("chat", "agent-A", "default")).toBe(
        "aura-gpt-5-5",
      );
      expect(loadPersistedModelForMode("image", "agent-A")).toBe(
        "gemini-nano-banana",
      );
      expect(loadPersistedModelForMode("video", "agent-A")).toBe(
        "dreamina-seedance-2-0-260128",
      );
      expect(loadPersistedModelForMode("3d", "agent-A")).toBe("tripo-v2");
    });

    it("loadPersistedVideoModel ignores stored ids that aren't valid video models", () => {
      // Manually write a chat model id under the video key (e.g.
      // because of pre-fix corruption) and verify the loader falls
      // through to the default rather than returning a non-video id.
      store["aura-selected-model:video:agent:agent-A"] = "aura-gpt-5-5";
      expect(loadPersistedVideoModel("agent-A")).toBe(
        "veo-3.1-fast-generate-preview",
      );
    });
  });
});

describe("effort-scaled credits", () => {
  describe("effortCreditFactor", () => {
    it("returns 1 at the model's default effort tier", () => {
      expect(effortCreditFactor("medium", "medium")).toBe(1);
      expect(effortCreditFactor("low", "low")).toBe(1);
      expect(effortCreditFactor("minimal", "minimal")).toBe(1);
    });

    it("defaults the baseline tier to medium when none is supplied", () => {
      expect(effortCreditFactor("medium")).toBe(1);
    });

    it("increases monotonically across tiers for a fixed baseline", () => {
      const factors = (
        ["minimal", "low", "medium", "high", "xhigh", "max"] as const
      ).map((e) => effortCreditFactor(e, "medium"));
      for (let i = 1; i < factors.length; i++) {
        expect(factors[i]).toBeGreaterThan(factors[i - 1]);
      }
    });

    it("scales the budget table blended with the base output tokens", () => {
      // (2000 + 4096) / (2000 + 10000) = 6096 / 12000.
      expect(effortCreditFactor("low", "medium")).toBeCloseTo(6096 / 12000, 6);
      // (2000 + 24000) / (2000 + 10000) = 26000 / 12000.
      expect(effortCreditFactor("high", "medium")).toBeCloseTo(26000 / 12000, 6);
    });
  });

  describe("effectiveCreditMultiplier", () => {
    const withEfforts: ModelOption = {
      id: "test-model",
      label: "Test",
      tier: "opus",
      mode: "chat",
      creditMultiplier: 15,
      efforts: ["low", "medium", "high", "max"],
      defaultEffort: "medium",
    };

    it("returns null when the model has no credit multiplier", () => {
      const noMultiplier: ModelOption = {
        id: "img",
        label: "Img",
        tier: "image",
        mode: "image",
      };
      expect(effectiveCreditMultiplier(noMultiplier, "high")).toBeNull();
    });

    it("returns the static multiplier when the model has no effort tiers", () => {
      const noEfforts: ModelOption = {
        id: "kimi",
        label: "Kimi",
        tier: "sonnet",
        mode: "chat",
        creditMultiplier: 2,
      };
      expect(effectiveCreditMultiplier(noEfforts, "high")).toBe(2);
    });

    it("returns the static multiplier when no effort is selected", () => {
      expect(effectiveCreditMultiplier(withEfforts, null)).toBe(15);
    });

    it("scales the multiplier by the effort factor", () => {
      expect(effectiveCreditMultiplier(withEfforts, "medium")).toBe(15);
      expect(effectiveCreditMultiplier(withEfforts, "low")).toBeCloseTo(
        15 * (6096 / 12000),
        6,
      );
      expect(effectiveCreditMultiplier(withEfforts, "high")).toBeCloseTo(
        15 * (26000 / 12000),
        6,
      );
    });

    it("keeps a free (0x) model free at every effort tier", () => {
      const free: ModelOption = {
        id: "oss",
        label: "OSS",
        tier: "haiku",
        mode: "chat",
        creditMultiplier: 0,
        efforts: ["low", "medium", "high"],
        defaultEffort: "medium",
      };
      expect(effectiveCreditMultiplier(free, "high")).toBe(0);
    });
  });
});

describe("reasoning-effort validity per model", () => {
  it("never lists a defaultEffort that is not also an offered effort", () => {
    for (const model of AURA_MANAGED_CHAT_MODELS) {
      if (!model.defaultEffort) continue;
      expect(
        model.efforts ?? [],
        `${model.id} defaultEffort "${model.defaultEffort}" must be in its efforts`,
      ).toContain(model.defaultEffort);
    }
  });

  it("offers the GPT-5.4/5.5 effort ladder", () => {
    for (const id of ["aura-gpt-5-4", "aura-gpt-5-4-mini", "aura-gpt-5-4-nano"]) {
      const model = AURA_MANAGED_CHAT_MODELS.find((m) => m.id === id);
      expect(model, `${id} should exist`).toBeDefined();
      expect(model?.efforts ?? []).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
    }
    expect(AURA_MANAGED_CHAT_MODELS.find((m) => m.id === "aura-gpt-5-5")?.efforts).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("offers all six native GPT-5.6 reasoning efforts and correct multipliers", () => {
    for (const [id, multiplier] of [
      ["aura-gpt-5-6-sol", 6],
      ["aura-gpt-5-6-terra", 3],
      ["aura-gpt-5-6-luna", 1.2],
    ] as const) {
      const model = AURA_MANAGED_CHAT_MODELS.find((m) => m.id === id);
      expect(model, `${id} should exist`).toBeDefined();
      expect(model).toMatchObject({
        vendor: "openai",
        creditMultiplier: multiplier,
        contextWindow: 1_050_000,
        defaultEffort: "medium",
      });
      expect(model?.efforts).toEqual([
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
      expect(effectiveCreditMultiplier(model!, model!.defaultEffort)).toBe(multiplier);
    }
  });

  it("keeps GPT-5.5 pricing metadata aligned with the API rate card", () => {
    const model = AURA_MANAGED_CHAT_MODELS.find((m) => m.id === "aura-gpt-5-5");
    expect(model?.creditMultiplier).toBe(6);
    expect(model?.contextWindow).toBe(1_050_000);
    expect(model?.defaultEffort).toBe("medium");
  });

  it("uses OpenAI's native no-reasoning default for the GPT-5.4 family", () => {
    for (const id of ["aura-gpt-5-4", "aura-gpt-5-4-mini", "aura-gpt-5-4-nano"]) {
      const model = AURA_MANAGED_CHAT_MODELS.find((m) => m.id === id);
      expect(model?.defaultEffort).toBe("minimal");
    }
  });

  it("maps Grok 4.3 onto the xAI reasoning effort ladder", () => {
    const model = AURA_MANAGED_CHAT_MODELS.find((m) => m.id === "aura-grok-4-3");
    expect(model?.efforts ?? []).toEqual(["minimal", "low", "medium", "high"]);
    expect(model?.defaultEffort).toBe("low");
  });

  it("maps Grok 4.5 onto the current xAI reasoning effort ladder", () => {
    const model = AURA_MANAGED_CHAT_MODELS.find((m) => m.id === "aura-grok-4-5");
    expect(model?.efforts ?? []).toEqual(["low", "medium", "high"]);
    expect(model?.defaultEffort).toBe("high");
    expect(model?.contextWindow).toBe(500_000);
  });

  it("offers Grok Build as a cheaper xAI model without effort controls", () => {
    const model = AURA_MANAGED_CHAT_MODELS.find(
      (m) => m.id === "aura-grok-build-0-1",
    );
    expect(model).toBeDefined();
    expect(model?.vendor).toBe("xai");
    expect(model?.creditMultiplier).toBe(0.48);
    expect(model?.contextWindow).toBe(256_000);
    expect(model?.efforts).toBeUndefined();
    expect(model?.defaultEffort).toBeUndefined();
  });
});
