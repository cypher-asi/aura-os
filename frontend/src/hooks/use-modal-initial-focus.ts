import { useRef, type RefObject } from "react";
import { useAuraCapabilities } from "./use-aura-capabilities";

export function useModalInitialFocus<T extends HTMLElement>() {
  const { isMobileLayout } = useAuraCapabilities();
  const inputRef = useRef<T>(null);
  const initialFocusRef = isMobileLayout
    ? undefined
    : (inputRef as RefObject<HTMLElement>);

  return {
    inputRef,
    initialFocusRef,
    autoFocus: !isMobileLayout,
  };
}
