# T3 improvements, batch 2

Reference checkout: `pingdotgg/t3code` at
`8ff9ae1f87e2b7c62cfacffd08921ff40bb089b1`, refreshed for this comparison.
Aura base: `73aad900adb43fc8051bd55d31ad38c3cb94946a`.

Only the combined branch gets a pull request. The source branches are retained
for focused review and future work; none has a separate PR or release trigger.
Ordinary integration merges retain the original implementation commits below.

| Improvement | Source branch | Original commit | T3 reference |
| --- | --- | --- | --- |
| Select a whole inline-code value on double-click | `codex/t3-inline-code-selection` | `1f2a26d439ded1d691581e159606b4ef4021f58f` | [Inline code selection](https://github.com/pingdotgg/t3code/commit/725573f35850b3414f2e71a55ea7b8412fcfac1e) |
| Filter and navigate changed files in directory order | `codex/t3-review-file-filters` | `e12d9e9dea1c81946f06a12a621751baa3e5bde4` | [Diff tree ordering and test filtering](https://github.com/pingdotgg/t3code/commit/a5448f4c5030b4f70744db5ecfec4cc06828b621) |
| Render local Git changes before review metadata | `codex/t3-local-git-first` | `2bdf46239bbbe073ce363be1bacdba10a5244083` | [Local status before remote lookup](https://github.com/pingdotgg/t3code/commit/e677e9799df44fd33d96890cb80dc0ee64d1221d) |

## Resulting behavior

- Inline code selects the entire path, flag, URL, or Unicode value rather than
  stopping at punctuation. Code fences retain normal selection and their Copy
  action. The rendered text and Markdown source are unchanged.
- Changed files support literal path/rename-source filtering and a toggle for
  common test/support file conventions. Folders stay contiguous with natural
  numeric ordering. Previous/next actions follow the rendered staged/worktree
  order, wrap around, and distinguish the two areas even for the same path.
  Filtering retains the selected diff and explains when it is hidden. Bulk
  actions explicitly say "visible" and affect only displayed entries. A warning
  explains that hidden staged entries still participate in a commit. Filters
  remain local to the current workspace view.
- Local/hosted workbenches first request status with
  `include_pull_request=false`, then load optional review metadata separately.
  Local file operations and diffs do not wait for GitHub. Late responses only
  update matching-branch review metadata; their file/ahead/behind data is not
  reused. Refresh, workspace changes, and failed metadata requests are guarded.
  Viewed-file marks wait until their original review scope is known, preserving
  existing marks. Project authorization is unchanged. Remote-agent workbenches
  retain their existing transport; older servers that ignore the opt-out still
  work, with their original status latency. The existing status API continues
  to include review lookup by default for other callers.

## Validation

- 595 frontend tests passed across 62 files on the combined branch, including
  the existing chat/mobile/terminal regressions and the new selection, filter,
  navigation, deferred-metadata, failure, and stale-response cases.
- All nine server source-control unit tests passed, including proof that a
  local-only request does not invoke review lookup.
- Production frontend build, targeted ESLint, mobile ESLint, and the existing
  CSS color guard passed.
- Browser verification used a synthetic fixture rendering the real components.
  Files/diffs were visible while metadata remained deliberately delayed; review
  enrichment subsequently appeared. Filtering, rename matching, navigation,
  and restoring a hidden selection worked. A 390px viewport had no page-wide
  horizontal overflow and the new controls measured 44px high.
- Native device testing and hosted CI results are still outstanding when this
  batch is prepared. No release, version, workflow, or signing settings change.

Keep the combined PR unmerged until reviewed. When approved, use **Create a
merge commit** so the implementation SHAs remain part of main's history. That
single main push starts the existing release cycle; do not merge the source
branches separately or squash this batch if original commit identities matter.
