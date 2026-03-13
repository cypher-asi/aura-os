import { createContext, useContext, useCallback, useState, useRef, type ReactNode } from "react";
import type { Spec } from "../types";

type SidekickMode = "idle" | "streaming" | "viewing" | "info";

interface SidekickState {
  isOpen: boolean;
  mode: SidekickMode;
  title: string;
  streamedText: string;
  streamStage: string;
  tokenCount: number;
  selectedSpec: Spec | null;
  infoContent: ReactNode;
}

interface SidekickActions {
  startStreaming: (title: string) => void;
  appendDelta: (text: string) => void;
  setStreamStage: (stage: string) => void;
  setTokenCount: (count: number) => void;
  finishStreaming: () => void;
  viewSpec: (spec: Spec) => void;
  showInfo: (title: string, content: ReactNode) => void;
  toggleInfo: (title: string, content: ReactNode) => void;
  close: () => void;
}

type SidekickContextValue = SidekickState & SidekickActions;

const INITIAL_STATE: SidekickState = {
  isOpen: false,
  mode: "idle",
  title: "",
  streamedText: "",
  streamStage: "",
  tokenCount: 0,
  selectedSpec: null,
  infoContent: null,
};

const SidekickContext = createContext<SidekickContextValue | null>(null);

export function SidekickProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SidekickState>(INITIAL_STATE);
  const streamBufferRef = useRef("");

  const startStreaming = useCallback((title: string) => {
    streamBufferRef.current = "";
    setState({
      isOpen: true,
      mode: "streaming",
      title,
      streamedText: "",
      streamStage: "",
      tokenCount: 0,
      selectedSpec: null,
      infoContent: null,
    });
  }, []);

  const appendDelta = useCallback((text: string) => {
    streamBufferRef.current += text;
    const snapshot = streamBufferRef.current;
    setState((prev) =>
      prev.mode === "streaming" ? { ...prev, streamedText: snapshot } : prev,
    );
  }, []);

  const setStreamStage = useCallback((stage: string) => {
    setState((prev) =>
      prev.mode === "streaming" ? { ...prev, streamStage: stage } : prev,
    );
  }, []);

  const setTokenCount = useCallback((count: number) => {
    setState((prev) =>
      prev.mode === "streaming" ? { ...prev, tokenCount: count } : prev,
    );
  }, []);

  const finishStreaming = useCallback(() => {
    setState((prev) =>
      prev.mode === "streaming" ? { ...prev, mode: "idle" } : prev,
    );
  }, []);

  const viewSpec = useCallback((spec: Spec) => {
    setState({
      isOpen: true,
      mode: "viewing",
      title: spec.title,
      streamedText: "",
      streamStage: "",
      tokenCount: 0,
      selectedSpec: spec,
      infoContent: null,
    });
  }, []);

  const showInfo = useCallback((title: string, content: ReactNode) => {
    setState({
      isOpen: true,
      mode: "info",
      title,
      streamedText: "",
      streamStage: "",
      tokenCount: 0,
      selectedSpec: null,
      infoContent: content,
    });
  }, []);

  const toggleInfo = useCallback((title: string, content: ReactNode) => {
    setState((prev) => {
      if (prev.isOpen && prev.mode === "info") {
        return INITIAL_STATE;
      }
      return {
        isOpen: true,
        mode: "info",
        title,
        streamedText: "",
        streamStage: "",
        tokenCount: 0,
        selectedSpec: null,
        infoContent: content,
      };
    });
  }, []);

  const close = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return (
    <SidekickContext.Provider
      value={{
        ...state,
        startStreaming,
        appendDelta,
        setStreamStage,
        setTokenCount,
        finishStreaming,
        viewSpec,
        showInfo,
        toggleInfo,
        close,
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
