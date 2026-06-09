import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { RAIL_LOGOS } from "./service-rail-logos";
import "./ServiceConnectionField.css";

/**
 * SVG mesh that wires each service rail nozzle to a band of nozzles down the
 * device's left edge. Lines are gray at rest; when a rail key lights (auto-
 * cycle or click), every line leaving that key lights gold in step with the
 * `litLogos` set owned by the parent `TrustDeviceStage`.
 *
 * Nozzle positions are measured from the live DOM (the rail and device place
 * real nozzle elements tagged `data-rail-nozzle` / `data-device-nozzle`), so
 * the mesh stays glued to them across resizes without hard-coded geometry.
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Edge {
  readonly source: number;
  readonly target: number;
}

interface ServiceConnectionFieldProps {
  readonly stageRef: RefObject<HTMLDivElement | null>;
  readonly litLogos: ReadonlySet<number>;
  readonly deviceNozzleCount: number;
}

/** How many device nozzles each rail key fans to on either side of center. */
const FAN_SPREAD = 3;

/**
 * Deterministic many-to-many mapping: each rail key targets a vertical band
 * of device nozzles centered on its proportional position, so the lines fan
 * out and cross like a flow diagram.
 */
function buildEdges(railCount: number, deviceCount: number): Edge[] {
  if (railCount === 0 || deviceCount === 0) {
    return [];
  }
  const ratio = deviceCount / railCount;
  const edges: Edge[] = [];
  for (let i = 0; i < railCount; i += 1) {
    const center = Math.round((i + 0.5) * ratio - 0.5);
    for (let d = -FAN_SPREAD; d <= FAN_SPREAD; d += 1) {
      const j = center + d;
      if (j >= 0 && j < deviceCount) {
        edges.push({ source: i, target: j });
      }
    }
  }
  return edges;
}

function readPoints(
  stage: HTMLElement,
  selector: string,
  attr: string,
  count: number,
): Point[] {
  const stageRect = stage.getBoundingClientRect();
  const points = new Array<Point | undefined>(count);
  stage.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const index = Number(el.dataset[attr]);
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

function curve(from: Point, to: Point): string {
  const dx = (to.x - from.x) * 0.5;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${(from.x + dx).toFixed(1)} ${from.y.toFixed(1)}, ${(to.x - dx).toFixed(1)} ${to.y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

export function ServiceConnectionField({
  stageRef,
  litLogos,
  deviceNozzleCount,
}: ServiceConnectionFieldProps): ReactNode {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [railPoints, setRailPoints] = useState<Point[]>([]);
  const [devicePoints, setDevicePoints] = useState<Point[]>([]);

  const edges = useMemo(
    () => buildEdges(RAIL_LOGOS.length, deviceNozzleCount),
    [deviceNozzleCount],
  );

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const rect = stage.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    setRailPoints(
      readPoints(stage, "[data-rail-nozzle]", "railNozzle", RAIL_LOGOS.length),
    );
    setDevicePoints(
      readPoints(
        stage,
        "[data-device-nozzle]",
        "deviceNozzle",
        deviceNozzleCount,
      ),
    );
  }, [stageRef, deviceNozzleCount]);

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

  if (
    railPoints.length === 0 ||
    devicePoints.length === 0 ||
    size.width === 0
  ) {
    return (
      <svg
        className="serviceConnectionField"
        aria-hidden="true"
        focusable="false"
      />
    );
  }

  const paths = edges
    .map((edge) => {
      const from = railPoints[edge.source];
      const to = devicePoints[edge.target];
      if (!from || !to) {
        return null;
      }
      return {
        key: `${edge.source}-${edge.target}`,
        d: curve(from, to),
        active: litLogos.has(edge.source),
      };
    })
    .filter((p): p is { key: string; d: string; active: boolean } => p !== null);

  return (
    <svg
      className="serviceConnectionField"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* Rest lines first, lit lines on top so the glow is never buried. */}
      <g className="serviceConnectionLines">
        {paths
          .filter((p) => !p.active)
          .map((p) => (
            <path key={p.key} d={p.d} />
          ))}
      </g>
      <g className="serviceConnectionLines serviceConnectionLinesActive">
        {paths
          .filter((p) => p.active)
          .map((p) => (
            <path key={p.key} d={p.d} data-active="true" />
          ))}
      </g>
    </svg>
  );
}
