import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { RAIL_LOGOS } from "./service-rail-logos";
import "./ServiceConnectionField.css";

/**
 * SVG that routes every service rail nozzle into a single converging port on
 * the device's left edge. Each line carries a continuous left-to-right light
 * pulse so it reads as energy flowing into the computer; when a rail key
 * lights (auto-cycle or click) its line surges gold, driven by the
 * `litLogos` set owned by the parent `TrustDeviceStage`.
 *
 * Endpoints are measured from the live DOM (the rail places nozzles tagged
 * `data-rail-nozzle`, the device a single `data-device-port`), so the lines
 * stay glued to them across resizes without hard-coded geometry.
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

interface ServiceConnectionFieldProps {
  readonly stageRef: RefObject<HTMLDivElement | null>;
  readonly litLogos: ReadonlySet<number>;
}

/** Spacing between staggered pulse starts, in seconds. */
const PULSE_STAGGER_S = 0.45;

function readRailPoints(stage: HTMLElement, count: number): Point[] {
  const stageRect = stage.getBoundingClientRect();
  const points = new Array<Point | undefined>(count);
  stage.querySelectorAll<HTMLElement>("[data-rail-nozzle]").forEach((el) => {
    const index = Number(el.dataset.railNozzle);
    if (Number.isNaN(index)) {
      return;
    }
    const rect = el.getBoundingClientRect();
    points[index] = {
      x: rect.left + rect.width / 2 - stageRect.left,
      y: rect.top + rect.height / 2 - stageRect.top,
    };
  });
  return points.filter((p): p is Point => p !== undefined);
}

function readPortPoint(stage: HTMLElement): Point | null {
  const el = stage.querySelector<HTMLElement>("[data-device-port]");
  if (!el) {
    return null;
  }
  const stageRect = stage.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - stageRect.left,
    y: rect.top + rect.height / 2 - stageRect.top,
  };
}

function curve(from: Point, to: Point): string {
  const dx = (to.x - from.x) * 0.5;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${(from.x + dx).toFixed(1)} ${from.y.toFixed(1)}, ${(to.x - dx).toFixed(1)} ${to.y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

export function ServiceConnectionField({
  stageRef,
  litLogos,
}: ServiceConnectionFieldProps): ReactNode {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [railPoints, setRailPoints] = useState<Point[]>([]);
  const [portPoint, setPortPoint] = useState<Point | null>(null);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const rect = stage.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    setRailPoints(readRailPoints(stage, RAIL_LOGOS.length));
    setPortPoint(readPortPoint(stage));
  }, [stageRef]);

  useLayoutEffect(() => {
    measure();
    // Re-measure once layout (and the WebGL canvas) has settled.
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [stageRef, measure]);

  if (railPoints.length === 0 || portPoint === null || size.width === 0) {
    return (
      <svg
        className="serviceConnectionField"
        aria-hidden="true"
        focusable="false"
      />
    );
  }

  // Stable, index-keyed line list so the CSS flow animation never restarts
  // when `litLogos` changes; only the `data-active` attribute toggles.
  const lines = railPoints.map((from, i) => ({
    key: i,
    d: curve(from, portPoint),
    active: litLogos.has(i),
  }));

  return (
    <svg
      className="serviceConnectionField"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {lines.map((line) => (
        <g
          key={line.key}
          className="serviceFlowLine"
          data-active={line.active ? "true" : undefined}
        >
          <path className="serviceFlowBase" d={line.d} pathLength={100} />
          <path
            className="serviceFlowPulse"
            d={line.d}
            pathLength={100}
            style={{ animationDelay: `${-line.key * PULSE_STAGGER_S}s` }}
          />
        </g>
      ))}
    </svg>
  );
}
