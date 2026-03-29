import { indexBy, sortByOrderIndex, titleSortKey, mergeById } from "./collections";

describe("indexBy", () => {
  it("indexes items by the given key function", () => {
    const items = [
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
    ];
    const map = indexBy(items, (i) => i.id);
    expect(map.get("a")).toEqual({ id: "a", name: "Alice" });
    expect(map.get("b")).toEqual({ id: "b", name: "Bob" });
    expect(map.size).toBe(2);
  });

  it("returns empty map for empty array", () => {
    const map = indexBy([], () => "x");
    expect(map.size).toBe(0);
  });

  it("last item wins on key collision", () => {
    const items = [
      { id: "a", val: 1 },
      { id: "a", val: 2 },
    ];
    const map = indexBy(items, (i) => i.id);
    expect(map.get("a")?.val).toBe(2);
    expect(map.size).toBe(1);
  });
});

describe("sortByOrderIndex", () => {
  it("sorts items ascending by order_index", () => {
    const items = [
      { order_index: 3, name: "c" },
      { order_index: 1, name: "a" },
      { order_index: 2, name: "b" },
    ];
    const result = sortByOrderIndex(items);
    expect(result.map((i) => i.name)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate original array", () => {
    const items = [
      { order_index: 2 },
      { order_index: 1 },
    ];
    const original = [...items];
    sortByOrderIndex(items);
    expect(items).toEqual(original);
  });

  it("handles empty array", () => {
    expect(sortByOrderIndex([])).toEqual([]);
  });

  it("handles single item", () => {
    const items = [{ order_index: 0 }];
    expect(sortByOrderIndex(items)).toEqual([{ order_index: 0 }]);
  });
});

describe("titleSortKey", () => {
  it("parses X.Y pattern into numeric key", () => {
    expect(titleSortKey("1.2 Some title")).toBe(100_002);
    expect(titleSortKey("3.14 Another")).toBe(300_014);
  });

  it("returns Infinity for non-matching titles", () => {
    expect(titleSortKey("No numbers here")).toBe(Infinity);
    expect(titleSortKey("")).toBe(Infinity);
  });

  it("handles single-digit sections", () => {
    expect(titleSortKey("0.0 Zero")).toBe(0);
  });

  it("produces correct ordering", () => {
    const titles = ["2.1 B", "1.3 A", "1.1 C", "10.0 D"];
    const sorted = [...titles].sort((a, b) => titleSortKey(a) - titleSortKey(b));
    expect(sorted).toEqual(["1.1 C", "1.3 A", "2.1 B", "10.0 D"]);
  });
});

describe("mergeById", () => {
  it("merges local and remote by id, remote wins", () => {
    const local = [
      { task_id: "a", order_index: 1, val: "old" },
    ];
    const remote = [
      { task_id: "a", order_index: 1, val: "new" },
      { task_id: "b", order_index: 2, val: "added" },
    ];
    const result = mergeById(local, remote, "task_id");
    expect(result).toHaveLength(2);
    expect(result[0].val).toBe("new");
    expect(result[1].val).toBe("added");
  });

  it("sorts result by order_index", () => {
    const local = [{ id: "a", order_index: 3 }];
    const remote = [{ id: "b", order_index: 1 }];
    const result = mergeById(local, remote, "id");
    expect(result[0].order_index).toBe(1);
    expect(result[1].order_index).toBe(3);
  });

  it("handles both empty", () => {
    const result = mergeById([], [], "order_index" as never);
    expect(result).toEqual([]);
  });

  it("handles empty remote", () => {
    const local = [{ id: "a", order_index: 0 }];
    const result = mergeById(local, [], "id");
    expect(result).toHaveLength(1);
  });

  it("handles empty local", () => {
    const remote = [{ id: "a", order_index: 0 }];
    const result = mergeById([], remote, "id");
    expect(result).toHaveLength(1);
  });
});
