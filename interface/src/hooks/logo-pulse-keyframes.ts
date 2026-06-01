import type { PulseMode } from "./use-desktop-logo-color";

export interface PulseConfig {
  pulseEnabled: boolean;
  pulseMode: PulseMode;
  pulseSpeed: number;
  pauseDuration: number;
  sweepReversed: boolean;
}

let _styleEl: HTMLStyleElement | null = null;

export function syncPulseKeyframes(p: PulseConfig): void {
  if (typeof document === "undefined") return;
  if (!_styleEl) {
    _styleEl = document.createElement("style");
    _styleEl.dataset.id = "aura-pulse";
    document.head.appendChild(_styleEl);
  }

  if (!p.pulseEnabled) {
    _styleEl.textContent = "";
    return;
  }

  const total = p.pulseSpeed + p.pauseDuration;
  const fi = ((p.pulseSpeed / 2 / total) * 100).toFixed(3);
  const pe = (((p.pulseSpeed / 2 + p.pauseDuration) / total) * 100).toFixed(3);

  _styleEl.textContent = `
@keyframes aura-logo-fade {
  0%      { background-color: var(--logo-pulse-from, white); }
  ${fi}%  { background-color: var(--logo-pulse-to, white); }
  ${pe}%  { background-color: var(--logo-pulse-to, white); }
  100%    { background-color: var(--logo-pulse-from, white); }
}
@keyframes aura-logo-sweep {
  0%      { clip-path: inset(0 100% 0 0); }
  ${fi}%  { clip-path: inset(0 0% 0 0); }
  ${pe}%  { clip-path: inset(0 0% 0 0); }
  100%    { clip-path: inset(0 0 0 100%); }
}
@keyframes aura-logo-sweep-rev {
  0%      { clip-path: inset(0 100% 0 0); }
  ${fi}%  { clip-path: inset(0 0% 0 0); }
  ${pe}%  { clip-path: inset(0 0% 0 0); }
  100%    { clip-path: inset(0 100% 0 0); }
}`;
}
