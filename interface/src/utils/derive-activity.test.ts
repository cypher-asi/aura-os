import {
  deriveActivity,
  agenticToolLabel,
  computeIterationStats,
} from "./derive-activity";
import type { ActivityItem, IterationStats } from "./derive-activity";

describe("deriveActivity", () => {
  it("returns a thinking item for empty buffer", () => {
    const result = deriveActivity("");
    expect(result).toEqual([
      { id: "thinking", message: "Generating response", status: "active" },
    ]);
  });

  describe("agentic format", () => {
    it("parses a single tool marker", () => {
      const buf = "[tool: read_file(src/main.ts) -> ok]";
      const result = deriveActivity(buf);
      expect(result).toEqual([
        { id: "tool-0", message: "Read `src/main.ts`", detail: undefined, status: "done" },
      ]);
    });

    it("parses multiple tool markers", () => {
      const buf =
        "[tool: read_file(a.ts) -> ok] some text [tool: write_file(b.ts) -> ok]";
      const result = deriveActivity(buf);
      expect(result).toHaveLength(2);
      expect(result[0].message).toBe("Read `a.ts`");
      expect(result[1].message).toBe("Write `b.ts`");
    });

    it("marks error tools with (failed) detail", () => {
      const buf = "[tool: run_command(npm test) -> error]";
      const result = deriveActivity(buf);
      expect(result[0].detail).toBe("(failed)");
      expect(result[0].status).toBe("done");
    });

    it("adds an active item for trailing text after last marker", () => {
      const buf = "[tool: read_file(a.ts) -> ok] Now analyzing the code";
      const result = deriveActivity(buf);
      expect(result).toHaveLength(2);
      expect(result[1]).toMatchObject({ id: "current", status: "active" });
    });

    it("returns thinking item when buffer is plain text with no markers", () => {
      const buf = "Let me think about this problem.";
      const result = deriveActivity(buf);
      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("Let me think about this problem.");
      expect(result[0].status).toBe("active");
    });

    it("handles tool markers without args", () => {
      const buf = "[tool: task_done -> ok]";
      const result = deriveActivity(buf);
      expect(result[0].message).toBe("Task complete");
    });

    it("returns thinking for agentic format with only whitespace trailing", () => {
      const buf = "[tool: read_file(x.ts) -> ok]   \n  ";
      const result = deriveActivity(buf);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("tool-0");
    });
  });

  describe("legacy JSON format", () => {
    it("returns thinking when buffer has opening brace only", () => {
      const buf = "{";
      const result = deriveActivity(buf);
      expect(result).toEqual([
        { id: "thinking", message: "Generating response", status: "active" },
      ]);
    });

    it("detects notes writing phase", () => {
      const buf = `{"notes": "Starting to analyze`;
      const result = deriveActivity(buf);
      expect(result.find((i) => i.id === "notes")?.status).toBe("active");
    });

    it("detects notes done phase", () => {
      const buf = `{"notes": "Analysis complete"`;
      const result = deriveActivity(buf);
      expect(result.find((i) => i.id === "notes")?.status).toBe("done");
    });

    it("detects file_ops with create verb", () => {
      const buf = `{"notes":"done","file_ops":[{"op":"create","path":"src/app.ts","content":"hello"}]}`;
      const result = deriveActivity(buf);
      const fileItem = result.find((i) => i.id === "file-0");
      expect(fileItem?.message).toBe("Creating src/app.ts");
      expect(fileItem?.status).toBe("done");
    });

    it("detects file_ops with modify verb", () => {
      const buf = `{"notes":"x","file_ops":[{"op":"modify","path":"a.ts","content":"y"}]}`;
      const result = deriveActivity(buf);
      expect(result.find((i) => i.id === "file-0")?.message).toBe("Modifying a.ts");
    });

    it("detects file_ops with delete verb", () => {
      const buf = `{"notes":"x","file_ops":[{"op":"delete","path":"old.ts","content":""}]}`;
      const result = deriveActivity(buf);
      expect(result.find((i) => i.id === "file-0")?.message).toBe("Deleting old.ts");
    });

    it("uses Processing for unknown op", () => {
      const buf = `{"notes":"x","file_ops":[{"op":"rename","path":"a.ts","content":""}]}`;
      const result = deriveActivity(buf);
      expect(result.find((i) => i.id === "file-0")?.message).toBe("Processing a.ts");
    });

    it("detects follow_up_tasks writing phase", () => {
      const buf = `{"notes":"x","file_ops":[],"follow_up_tasks":["do`;
      const result = deriveActivity(buf);
      const fup = result.find((i) => i.id === "followup");
      expect(fup?.status).toBe("active");
    });

    it("detects follow_up_tasks done phase", () => {
      const buf = `{"notes":"x","file_ops":[],"follow_up_tasks":["do more"]}`;
      const result = deriveActivity(buf);
      const fup = result.find((i) => i.id === "followup");
      expect(fup?.status).toBe("done");
    });

    it("returns thinking if buffer has no brace at all", () => {
      const result = deriveActivity("no json here");
      expect(result[0].status).toBe("active");
    });

    it("shows active status on the last incomplete file op", () => {
      const buf = `{"notes":"done","file_ops":[{"op":"create","path":"a.ts","content":"partial content`;
      const result = deriveActivity(buf);
      const fileItem = result.find((i) => i.id === "file-0");
      expect(fileItem?.status).toBe("active");
    });

    it("includes content progress detail for large content", () => {
      const longContent = "x".repeat(600);
      const buf = `{"notes":"done","file_ops":[{"op":"create","path":"a.ts","content":"${longContent}`;
      const result = deriveActivity(buf);
      const fileItem = result.find((i) => i.id === "file-0");
      expect(fileItem?.detail).toMatch(/writing content/);
    });
  });
});

describe("agenticToolLabel", () => {
  it("labels read_file with path", () => {
    expect(agenticToolLabel("read_file", "src/main.ts")).toBe("Read `src/main.ts`");
  });

  it("labels read_file without arg", () => {
    expect(agenticToolLabel("read_file")).toBe("Read file");
  });

  it("labels write_file", () => {
    expect(agenticToolLabel("write_file", "out.txt")).toBe("Write `out.txt`");
  });

  it("labels edit_file", () => {
    expect(agenticToolLabel("edit_file", "cfg.json")).toBe("Edit `cfg.json`");
  });

  it("labels delete_file", () => {
    expect(agenticToolLabel("delete_file", "tmp.log")).toBe("Delete `tmp.log`");
  });

  it("labels list_files", () => {
    expect(agenticToolLabel("list_files", "src/")).toBe("List `src/`");
  });

  it("labels search_code", () => {
    expect(agenticToolLabel("search_code", "TODO")).toBe("Search: TODO");
  });

  it("labels run_command", () => {
    expect(agenticToolLabel("run_command", "npm test")).toBe("Run: `npm test`");
  });

  it("labels task_done", () => {
    expect(agenticToolLabel("task_done")).toBe("Task complete");
  });

  it("labels get_task_context", () => {
    expect(agenticToolLabel("get_task_context")).toBe("Load task context");
  });

  it("labels unknown tool with arg", () => {
    expect(agenticToolLabel("custom_tool", "arg")).toBe("custom_tool: arg");
  });

  it("labels unknown tool without arg", () => {
    expect(agenticToolLabel("custom_tool")).toBe("Tool: custom_tool");
  });

  it("truncates long arg with ellipsis", () => {
    const longArg = "a".repeat(100);
    const result = agenticToolLabel("read_file", longArg);
    expect(result.length).toBeLessThan(100);
    expect(result).toContain("\u2026");
  });
});

describe("computeIterationStats", () => {
  it("returns zeros for empty buffer", () => {
    const stats = computeIterationStats("");
    expect(stats).toEqual<IterationStats>({
      total: 0, reads: 0, writes: 0, commands: 0, errors: 0, dots: [],
    });
  });

  it("counts read tools", () => {
    const buf = "[tool: read_file(a.ts) -> ok] [tool: list_files(src) -> ok]";
    const stats = computeIterationStats(buf);
    expect(stats.total).toBe(2);
    expect(stats.reads).toBe(2);
    expect(stats.writes).toBe(0);
  });

  it("counts write tools", () => {
    const buf = "[tool: write_file(a.ts) -> ok] [tool: edit_file(b.ts) -> ok] [tool: delete_file(c.ts) -> ok]";
    const stats = computeIterationStats(buf);
    expect(stats.writes).toBe(3);
  });

  it("counts command tools", () => {
    const buf = "[tool: run_command(npm test) -> ok]";
    const stats = computeIterationStats(buf);
    expect(stats.commands).toBe(1);
  });

  it("counts errors", () => {
    const buf = "[tool: run_command(npm test) -> error] [tool: read_file(x) -> ok]";
    const stats = computeIterationStats(buf);
    expect(stats.errors).toBe(1);
    expect(stats.total).toBe(2);
  });

  it("categorizes unknown tools as other", () => {
    const buf = "[tool: custom_tool(arg) -> ok]";
    const stats = computeIterationStats(buf);
    expect(stats.dots[0].category).toBe("other");
  });

  it("builds dots array in order", () => {
    const buf = "[tool: read_file(a) -> ok] [tool: write_file(b) -> error] [tool: run_command(c) -> ok]";
    const stats = computeIterationStats(buf);
    expect(stats.dots).toHaveLength(3);
    expect(stats.dots[0]).toEqual({ category: "read", isError: false });
    expect(stats.dots[1]).toEqual({ category: "write", isError: true });
    expect(stats.dots[2]).toEqual({ category: "command", isError: false });
  });
});
