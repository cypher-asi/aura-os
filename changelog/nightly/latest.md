# Loop Engineering task seeding and restorable archived agents

- Date: `2026-06-20`
- Channel: `nightly`
- Version: `0.1.0-nightly.704.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.704.1

Today's nightly brings two focused improvements: Loop Engineering runs now automatically come with a backing task so work is tracked from the first kickoff, and archived project agents finally remember their archive state with a clear path to restore them from the project list.

## 9:33 AM — Loop Engineering runs now auto-create a tracked task

Starting a Loop Engineering run on a project now seeds a corresponding task so the work is visible and trackable from the moment the loop kicks off.

- When a Loop Engineering contract is submitted to start_loop, the server now ensures a 'Loop Engineering' spec exists and creates a ready-state task titled and described from the run's goal, assigned to the loop's agent instance. (`0b49aab`)
- Seeded tasks are deduplicated against existing project tasks and broadcast over the task-saved channel so any open project view picks them up live. (`0b49aab`)

## 3:04 PM — Archived project agents persist and can be restored

Project agents now remember their archived status across sessions, and the project list exposes a dedicated Restore action to bring them back to idle.

- The agent state machine now permits transitioning an Archived instance back to Idle, making restore a first-class lifecycle operation rather than a dead end. (`3df3eca`)
- In the project list explorer, archived agents now show an ArchiveRestore action with a 'Restore {agent}' label in place of the Archive button, wired through the project-list actions hook and queries. (`3df3eca`)

## Highlights

- Loop Engineering runs auto-seed a tracked task
- Archived agents persist and can be restored from the project list

