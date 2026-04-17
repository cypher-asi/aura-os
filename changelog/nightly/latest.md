# 27 updates shipped

- Date: `2026-04-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.278.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/nightly

This nightly timeline for aura-os groups 71 landed commits into 27 updates on 2026-04-16 for `0.1.0-nightly.278.1`.

## 8:36 PM — Release Infrastructure and Interface updates

Fix desktop validate workflow env duplication. Fix desktop nightly updater versioning.

- Fix desktop validate workflow env duplication (`42464e7`)
- Fix desktop nightly updater versioning (`7548957`)
- Add sccache to desktop build workflows (`53a06a3`)

## 11:15 PM — Interface updates

Reset agent chat context after new sessions

- Reset agent chat context after new sessions (`4c469d2`)

## 11:46 PM — Release Infrastructure updates

Refactor changelog generation into timeline entries. Align nightly manifest publish versioning.

- Refactor changelog generation into timeline entries (`6ea4cb3`)
- Align nightly manifest publish versioning (`e1352cc`)

## 9:59 AM — Release Infrastructure updates

Improve desktop CI runner and timing instrumentation

- Improve desktop CI runner and timing instrumentation (`ea9a869`)

## 12:13 PM — Other updates

Merge branch 'main' of https://github.com/cypher-asi/aura-os

- Merge branch 'main' of https://github.com/cypher-asi/aura-os (`5289ffd`)

## 12:27 PM — Interface and Core Rust updates

Fix sidekick empty-state flash and align Run row height. Mirror specs to disk and show filename-style tool card.

- Fix sidekick empty-state flash and align Run row height (`3ca1d08`)
- Mirror specs to disk and show filename-style tool card (`cca9aae`)
- Fade tool card body out before collapsing (`c318901`)

## 2:29 PM — Release Infrastructure updates

Use larger desktop runners and switch changelog to Pacific time

- Use larger desktop runners and switch changelog to Pacific time (`25ada54`)

## 2:50 PM — Interface and Core Rust updates

Use totalCostUsd for Total Revenue tile. Move logout into team settings panel, drop app settings modal.

- Use totalCostUsd for Total Revenue tile (`f1effd4`)
- Move logout into team settings panel, drop app settings modal (`54d6ca8`)
- Eliminate post-stream jerk when the assistant bubble finalizes (`940c02c`)

## 3:27 PM — Interface updates

Render unwrapped delete error messages in project/agent flows. Smooth tool/thinking collapse so pinned chat stops blinking upward.

- Render unwrapped delete error messages in project/agent flows (`9dae22b`)
- Smooth tool/thinking collapse so pinned chat stops blinking upward (`ff67b0b`)

## 3:55 PM — Release Infrastructure updates

Fix cargo timings artifact upload paths. Fix Linux larger-runner desktop dependencies.

- Fix cargo timings artifact upload paths (`8c70b92`)
- Fix Linux larger-runner desktop dependencies (`5d2045b`)

## 4:00 PM — Interface updates

Repair markdown strong emphasis with trailing whitespace before closer. Show task title in create_task rows and make expand useful.

- Repair markdown strong emphasis with trailing whitespace before closer (`f3c3368`)
- Show task title in create_task rows and make expand useful (`74e0a1f`)

## 4:09 PM — Release Infrastructure updates

Add Linux toolchain packages on larger runners

- Add Linux toolchain packages on larger runners (`0ddff8d`)

## 4:13 PM — Interface and Core Rust updates

Stream partial tool inputs into spec and file preview cards. Tighten spacing between tool-only assistant bubbles.

- Stream partial tool inputs into spec and file preview cards (`b0bd9d7`)
- Tighten spacing between tool-only assistant bubbles (`272b699`)
- Only auto-expand tool rows with live preview content (`dd3fc98`)

## 4:28 PM — Release Infrastructure updates

Add OpenSSL dev headers on Linux larger runners

- Add OpenSSL dev headers on Linux larger runners (`88579ba`)

## 4:31 PM — Interface updates

Tighten tool row spacing further across bubble boundaries. Filter deleted tasks and specs from TaskList view.

- Tighten tool row spacing further across bubble boundaries (`c19ff79`)
- Filter deleted tasks and specs from TaskList view (`6cf7e30`)

## 4:33 PM — Core Rust updates

Log tool streaming flow to diagnose live preview lag

- Log tool streaming flow to diagnose live preview lag (`12be80e`)

## 4:34 PM — Interface updates

Stop reformatting assistant bubbles after stream finishes. Rename Swarm environment label to Remote in agent create form.

- Stop reformatting assistant bubbles after stream finishes (`38b6856`)
- Rename Swarm environment label to Remote in agent create form (`ed0edf5`)

## 4:47 PM — Core Rust updates

Add aura_project_id to SessionInit for router billing headers

- Add aura_project_id to SessionInit for router billing headers (`cfdd29d`)

## 4:49 PM — Other updates

Preserve tool-only assistant turns in chat history on reopen

- Preserve tool-only assistant turns in chat history on reopen (`0b340fa`)

## 4:49 PM — Core Rust and Other updates

Revert "Add aura_project_id to SessionInit for router billing headers". Refetch project stats when a chat stream ends.

- Revert "Add aura_project_id to SessionInit for router billing headers" (`3484cb2`)
- Refetch project stats when a chat stream ends (`8c9c42f`)
- Sum input+output tokens when aura-network totalTokens is 0 (`fc6fd91`)

## 5:23 PM — Interface updates

Prevent text selection and dragging on the AURA topbar logo. Disable text selection on topbar and left sidebar.

- Prevent text selection and dragging on the AURA topbar logo (`07253bf`)
- Disable text selection on topbar and left sidebar (`3f75764`)
- Keep prior messages visible after starting a new chat session (`3b9d7f0`)

## 6:11 PM — Core Rust updates

Stream visible spec markdown before calling create_spec/update_spec

- Stream visible spec markdown before calling create_spec/update_spec (`e5adacc`)

## 6:12 PM — Interface updates

Persist bootstrap ?host= query param into localStorage. Default billing plan badge to "pro" and drop team-centric copy.

- Persist bootstrap ?host= query param into localStorage (`000817b`)
- Default billing plan badge to "pro" and drop team-centric copy (`2f34e08`)

## 6:12 PM — Docs updates

Add hello-world website quick spec doc

- Add hello-world website quick spec doc (`24d6dc1`)

## 6:12 PM — Other updates

Merge branch 'main' of https://github.com/cypher-asi/aura-os

- Merge branch 'main' of https://github.com/cypher-asi/aura-os (`8b62dff`)

## 6:21 PM — Interface updates

Preserve terminal task status across listTasks refetches too. Keep chat anchor pinned while resizing the sidekick pane.

- Preserve terminal task status across listTasks refetches too (`4c3b40f`)
- Keep chat anchor pinned while resizing the sidekick pane (`5bcaff3`)
- Preserve terminal task status in the Kanban store (`5b95b6e`)

## 6:43 PM — Release Infrastructure updates

use python3 for normalize-packager-key step. Restore Linux desktop jobs to x64 hosted runners.

- use python3 for normalize-packager-key step (`ecd52f1`)
- Restore Linux desktop jobs to x64 hosted runners (`134278e`)

## Highlights

- Release Infrastructure and Interface updates
- Interface updates
- Release Infrastructure updates
- Release Infrastructure updates

