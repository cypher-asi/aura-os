import type { ReactNode } from "react";
import type { ExplorerNode } from "@cypher-asi/zui";

export type ExplorerNodeWithSuffix = Omit<ExplorerNode, "children"> & {
  suffix?: ReactNode;
  children?: ExplorerNodeWithSuffix[];
};
