import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type PerfBudgets = {
  startupMs: {
    maxDeltaFromEntry: Record<string, number>;
  };
  webVitals: {
    loginRoute: {
      maxLcpMsWhenPresent: number;
      maxCls: number;
    };
  };
};

export function loadPerfBudgets(): PerfBudgets {
  const path = join(__dirname, "../../../perf/budgets.json");
  return JSON.parse(readFileSync(path, "utf8")) as PerfBudgets;
}

export function deltaFromEntry(marks: Record<string, number>, markName: string): number {
  const t0 = marks["aura:app:entry"];
  const t1 = marks[markName];
  if (t0 === undefined || t1 === undefined) {
    throw new Error(`Missing marks for delta: entry=${t0}, ${markName}=${t1}`);
  }
  return t1 - t0;
}
