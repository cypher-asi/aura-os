import { useEffect } from "react";

function containsTarget(refs: React.RefObject<HTMLElement | null> | React.RefObject<HTMLElement | null>[], target: Node): boolean {
  const arr = Array.isArray(refs) ? refs : [refs];
  return arr.some((r) => r.current && r.current.contains(target));
}

export function useClickOutside(
  ref: React.RefObject<HTMLElement | null> | React.RefObject<HTMLElement | null>[],
  onClose: () => void,
  isActive: boolean,
): void {
  useEffect(() => {
    if (!isActive) return;
    const handleClick = (e: MouseEvent) => {
      if (!containsTarget(ref, e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [ref, onClose, isActive]);
}
