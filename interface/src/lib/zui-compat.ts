import type { CSSProperties, ReactNode } from "react";
import type { ExplorerNode } from "@cypher-asi/zui";

export type ExplorerNodeWithSuffix = Omit<ExplorerNode, "children"> & {
  suffix?: ReactNode;
  /** Inline style applied to the rendered label text. Consumed by the
   *  `features/left-menu` renderer so per-project text customizations
   *  (e.g. name color from appearance settings) can flow through
   *  without LeftMenu having to know about the source. */
  labelStyle?: CSSProperties;
  /** Inline style applied to the rendered row container (the project
   *  "header" div in `features/left-menu`). Used for per-project
   *  background fill / outline driven by appearance settings. */
  headerStyle?: CSSProperties;
  children?: ExplorerNodeWithSuffix[];
};
