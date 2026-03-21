import { useRef, type RefObject } from "react";
import { useAuraCapabilities } from "./use-aura-capabilities";

interface UseModalInitialFocusResult<T extends HTMLElement> {
  inputRef: RefObject<T | null>;
  initialFocusRef: RefObject<HTMLElement> | undefined;
  autoFocus: boolean;
}

export function useModalInitialFocus<T extends HTMLElement>(): UseModalInitialFocusResult<T> {
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
