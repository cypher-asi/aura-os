import { createContext, useContext, useCallback, useState, useRef, useEffect, type ReactNode } from "react";
import type { Spec } from "../types";

type SidekickTab = "specs" | "tasks" | "progress";

interface ChatState {
  isStreaming: boolean;
  streamTitle: string;
  streamedText: string;
  streamStage: string;
  tokenCount: number;
  savedSpecs: Spec[];
}

interface PanelState {
  activeTab: SidekickTab;
  selectedSpec: Spec | null;
  infoContent: ReactNode;
  showInfo: boolean;
}

interface ChatActions {
  startStreaming: (title: string) => void;
  appendDelta: (text: string) => void;
  setStreamStage: (stage: string) => void;
  setTokenCount: (count: number) => void;
  appendSavedSpec: (spec: Spec) => void;
  finishStreaming: () => void;
}

interface PanelActions {
  setActiveTab: (tab: SidekickTab) => void;
  viewSpec: (spec: Spec) => void;
  clearSpec: () => void;
  toggleInfo: (title: string, content: ReactNode) => void;
}

type SidekickContextValue = ChatState & PanelState & ChatActions & PanelActions;

const INITIAL_CHAT: ChatState = {
  isStreaming: false,
  streamTitle: "",
  streamedText: "",
  streamStage: "",
  tokenCount: 0,
  savedSpecs: [],
};

const INITIAL_PANEL: PanelState = {
  activeTab: "specs",
  selectedSpec: null,
  infoContent: null,
  showInfo: false,
};

const SidekickContext = createContext<SidekickContextValue | null>(null);

export function SidekickProvider({ children }: { children: React.ReactNode }) {
  const [chat, setChat] = useState<ChatState>(INITIAL_CHAT);
  const [panel, setPanel] = useState<PanelState>(INITIAL_PANEL);
  const streamBufferRef = useRef("");
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const startStreaming = useCallback((title: string) => {
    streamBufferRef.current = "";
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setChat({
      isStreaming: true,
      streamTitle: title,
      streamedText: "",
      streamStage: "",
      tokenCount: 0,
      savedSpecs: [],
    });
  }, []);

  const appendDelta = useCallback((text: string) => {
    streamBufferRef.current += text;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const snapshot = streamBufferRef.current;
        setChat((prev) =>
          prev.isStreaming ? { ...prev, streamedText: snapshot } : prev,
        );
      });
    }
  }, []);

  const setStreamStage = useCallback((stage: string) => {
    setChat((prev) =>
      prev.isStreaming ? { ...prev, streamStage: stage } : prev,
    );
  }, []);

  const setTokenCount = useCallback((count: number) => {
    setChat((prev) =>
      prev.isStreaming ? { ...prev, tokenCount: count } : prev,
    );
  }, []);

  const appendSavedSpec = useCallback((spec: Spec) => {
    setChat((prev) =>
      prev.isStreaming
        ? { ...prev, savedSpecs: [...prev.savedSpecs, spec] }
        : prev,
    );
  }, []);

  const finishStreaming = useCallback(() => {
    setChat((prev) =>
      prev.isStreaming ? { ...prev, isStreaming: false } : prev,
    );
  }, []);

  const setActiveTab = useCallback((tab: SidekickTab) => {
    setPanel((prev) => ({ ...prev, activeTab: tab, selectedSpec: null, showInfo: false }));
  }, []);

  const viewSpec = useCallback((spec: Spec) => {
    setPanel((prev) => ({ ...prev, selectedSpec: spec, showInfo: false }));
  }, []);

  const clearSpec = useCallback(() => {
    setPanel((prev) => ({ ...prev, selectedSpec: null }));
  }, []);

  const toggleInfo = useCallback((title: string, content: ReactNode) => {
    setPanel((prev) => {
      if (prev.showInfo) {
        return { ...prev, showInfo: false, infoContent: null };
      }
      return { ...prev, showInfo: true, infoContent: content };
    });
  }, []);

  return (
    <SidekickContext.Provider
      value={{
        ...chat,
        ...panel,
        startStreaming,
        appendDelta,
        setStreamStage,
        setTokenCount,
        appendSavedSpec,
        finishStreaming,
        setActiveTab,
        viewSpec,
        clearSpec,
        toggleInfo,
      }}
    >
      {children}
    </SidekickContext.Provider>
  );
}

export function useSidekick(): SidekickContextValue {
  const ctx = useContext(SidekickContext);
  if (!ctx) {
    throw new Error("useSidekick must be used within a SidekickProvider");
  }
  return ctx;
}
