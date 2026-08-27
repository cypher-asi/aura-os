import { describe, expect, it } from "vitest";
import {
  filterPaletteGroups,
  flattenPaletteGroups,
  nextEnabledPaletteIndex,
  type PaletteSearchGroup,
  type PaletteSearchItem,
} from "./command-palette-logic";

const groups: PaletteSearchGroup[] = [
  {
    id: "projects",
    label: "Projects",
    items: [
      {
        id: "project:aura",
        title: "Aura OS",
        subtitle: "Continuous agentic coding",
        searchTerms: ["workspace", "rust"],
      },
      {
        id: "project:router",
        title: "Aura Router",
        subtitle: "Model routing service",
        searchTerms: ["typescript"],
      },
    ],
  },
  {
    id: "actions",
    label: "Actions",
    items: [
      {
        id: "action:new-project",
        title: "New Project",
        subtitle: "File",
        searchTerms: ["create", "workspace"],
      },
      {
        id: "action:settings",
        title: "Settings",
        subtitle: "File",
        searchTerms: ["preferences"],
      },
    ],
  },
];

describe("command palette search", () => {
  it("preserves group and item order for an empty query", () => {
    expect(filterPaletteGroups(groups, "")).toEqual(groups);
  });

  it("supports multi-token matches across title and metadata", () => {
    const result = filterPaletteGroups(groups, "aura rust");
    expect(flattenPaletteGroups(result).map((item) => item.id)).toEqual([
      "project:aura",
    ]);
  });

  it("ranks an exact title above a metadata match", () => {
    const result = filterPaletteGroups(
      [
        {
          id: "mixed",
          label: "Mixed",
          items: [
            {
              id: "metadata",
              title: "Preferences",
              searchTerms: ["settings"],
            },
            { id: "exact", title: "Settings", searchTerms: [] },
          ],
        },
      ],
      "settings",
    );
    expect(flattenPaletteGroups(result).map((item) => item.id)).toEqual([
      "exact",
      "metadata",
    ]);
  });

  it("uses > to search actions only", () => {
    const result = filterPaletteGroups(groups, "> workspace");
    expect(result.map((group) => group.id)).toEqual(["actions"]);
    expect(flattenPaletteGroups(result).map((item) => item.id)).toEqual([
      "action:new-project",
    ]);
  });
});

describe("command palette keyboard selection", () => {
  const items: PaletteSearchItem[] = [
    { id: "one", title: "One", searchTerms: [] },
    { id: "two", title: "Two", searchTerms: [], disabled: true },
    { id: "three", title: "Three", searchTerms: [] },
  ];

  it("wraps and skips disabled entries", () => {
    expect(nextEnabledPaletteIndex(items, 0, 1)).toBe(2);
    expect(nextEnabledPaletteIndex(items, 2, 1)).toBe(0);
    expect(nextEnabledPaletteIndex(items, 0, -1)).toBe(2);
  });
});
