# T3 improvements: combined merge and release plan

Prepared October 28, 2026, from `origin/main` at
`e4e34d8048ba1ccdd4ac1f6a402ad94ae76680a6`.

## One integration PR, original commits retained

`codex/t3-release-batch` combines the 14 T3 improvement PRs for one PR validation
cycle and one eventual push to `main`. The feature branches were merged with
ordinary merge commits. All 15 original implementation commits retain their
SHA, author, message, and ancestry; none were cherry-picked or squashed.
The three existing dependency stacks are included through their top branches.

Use GitHub's **Create a merge commit** for the final batch PR. Repository settings
were checked and allow this method. Squashing the batch would discard the
original commits from main's ancestry. Rebasing the batch would rewrite their
identities. Do not merge the original feature PRs individually as well.

The extra integration merge commits describe which original PRs were combined;
they do not trigger individual releases. The release workflows react to pushes
to `main`, not to each commit contained in that push.

## Included work

| Original PR | Behavior | Original implementation commit(s) |
| --- | --- | --- |
| [#214](https://github.com/cypher-asi/aura-os/pull/214) | Preserve terminal UTF-8 input and output | `19f619cd02afb53066fe5401492af8523b86384d` |
| [#215](https://github.com/cypher-asi/aura-os/pull/215) | Cancel stale terminal connections | `523a2252a38d7cd06e186cffbde459ccc74a0f66` |
| [#217](https://github.com/cypher-asi/aura-os/pull/217) | Isolate terminal multiplexer environment | `e9c69009a041a1a6f4ecf13723a8069e1f1ed1de` |
| [#218](https://github.com/cypher-asi/aura-os/pull/218) | Preserve IME confirmation and ignore repeated Enter | `748a68104ae4b4a6c2378c6872e5ee7995461397` |
| [#219](https://github.com/cypher-asi/aura-os/pull/219) | Retry failed review diffs with the correct scope | `f8044507d0dc432b26de2067240738cc9d2a19c0` |
| [#220](https://github.com/cypher-asi/aura-os/pull/220) | Keep terminal application arrows out of shell history | `a5682e92963fb283250d5478307ca2396c7aa669` |
| [#221](https://github.com/cypher-asi/aura-os/pull/221) | Copy individual code blocks | `401acbc86f02a69859773f93b8b6f5c54457716c` |
| [#222](https://github.com/cypher-asi/aura-os/pull/222) | Copy and wrap mobile source previews | `0b646f215b12c05fc79471874f6ced076985603e` |
| [#223](https://github.com/cypher-asi/aura-os/pull/223) | Dismiss the mobile keyboard without losing a draft | `fb0215bbd690eb0ffbab8ea7ed35c653dbdb1b85` |
| [#225](https://github.com/cypher-asi/aura-os/pull/225) | Persist queue ordering and cap mobile queue height | `53d47ae2d79b0aac979a3b9d4a971c96177abed3`, `cf58bbd12d2c09a5311e152b4be1b023f2d86f8c` |
| [#226](https://github.com/cypher-asi/aura-os/pull/226) | Find and jump to loaded messages | `e72a6131d308829cba963c79cccabaf948086254` |
| [#227](https://github.com/cypher-asi/aura-os/pull/227) | Copy tables as CSV or original Markdown | `9110bbeaaed54ca7ebf3e1f58c3252c5ebf79973` |
| [#228](https://github.com/cypher-asi/aura-os/pull/228) | Preserve Windows paths in Markdown prose | `b2199d4dcb2709e1a02a1232872fc42f154721da` |
| [#229](https://github.com/cypher-asi/aura-os/pull/229) | Browse bounded CSV/TSV previews on mobile | `7b922a8506300d4d811c3f503b796cde94ec6271` |

## Validation and merge sequence

1. Run the combined PR's normal required checks and resolve failures there.
   Do not rerun the 14 old PR suites merely to merge this batch. Do not skip
   required checks or change branch protection to permit the merge.
2. Review the combined diff and native validation results. Local validation on
   the combined branch passed 556 frontend tests in 58 files, the production
   frontend build, and all five `aura-os-terminal` unit tests. Earlier phone
   browser checks covered touch controls, search navigation, queue ordering,
   preserved drafts, and table/source switching. Native device testing remains
   outstanding; a browser check does not replace it.
3. Obtain approval for the concrete combined PR and its automatic release
   effects, then merge it once using **Create a merge commit**.
4. Close any original PRs still open as superseded by the batch. Keep their
   branches and review records for traceability. Do not merge them separately.
5. Check the resulting release workflows and published artifacts at the merged
   SHA. Retry only failed jobs/runs when appropriate; avoid another main commit
   or manual publication of a channel that already succeeded.

## Current release behavior after the single main merge

| Channel | Workflow | Current trigger/effect |
| --- | --- | --- |
| Desktop nightly | `.github/workflows/release-nightly.yml` | Main push builds desktop platforms and publishes validated nightly assets/update manifests. Publication can be partial across platforms; inspect each platform result. |
| Android nightly | `.github/workflows/release-mobile-nightly.yml` | Main push builds/publishes the signed Android GitHub nightly APK. iOS in this workflow is manual-only. |
| iOS beta | `.github/workflows/ios-mobile.yml` | Main push runs shell validation and the `ios beta` lane for TestFlight. App Store submission remains manual. |
| Android Play | `.github/workflows/android-mobile.yml` | Main push validates the shell. A Play upload needs a separate manual lane/track/status selection. |
| Desktop stable | `.github/workflows/release-stable.yml` | A `v*` tag or an explicit manual run is required; a main merge alone does not publish stable. |

Existing desktop, mobile, analytics, security, and eval checks still apply to
the combined PR. Main push checks also remain enabled. This consolidation does
not disable workflows or turn multiple platform jobs into a single job; it
avoids running the full change-validation/release cycle once per feature PR.

The desktop base version is currently `0.1.0`; nightly versions are derived from
the workflow run number. Conventional commit messages do not independently
bump that version. For a future stable publication, select and validate the
desired version and tag after the nightly/TestFlight checks; do not create
per-feature tags or assume each semantic commit needs a release.
