import { useState } from "react";
import { fireEvent, render, screen } from "../../test/render";
import type { ListTreeNode } from "../../components/ListTree";
import { MobileFileList } from "./MobileFileList";

const nodes: ListTreeNode[] = [
  {
    id: "__files_root__",
    label: "workspace",
    children: [
      {
        id: "/workspace/src",
        label: "src",
        metadata: { is_dir: true },
        children: [{ id: "/workspace/src/app.ts", label: "app.ts" }],
      },
    ],
  },
];

describe("MobileFileList", () => {
  it("toggles folders instead of rendering the entire tree at once", () => {
    const onFileSelect = vi.fn();

    function Harness() {
      const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
        () => new Set(["__files_root__"]),
      );
      return (
        <MobileFileList
          nodes={nodes}
          features={{ ideIntegration: false } as never}
          isRemote
          onFileSelect={onFileSelect}
          rootPath="/workspace"
          expandedIds={expandedIds}
          onToggleDirectory={(nodeId) => {
            setExpandedIds((current) => {
              const next = new Set(current);
              if (next.has(nodeId)) next.delete(nodeId);
              else next.add(nodeId);
              return next;
            });
          }}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole("button", { name: /src/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("button", { name: /app\.ts/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /src/i }));
    expect(screen.getByRole("button", { name: /src/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: /app\.ts/i }));
    expect(onFileSelect).toHaveBeenCalledWith("/workspace/src/app.ts");
  });
});
