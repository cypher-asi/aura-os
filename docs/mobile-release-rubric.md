# Mobile Release Rubric

This rubric is the gate for shipping mobile experience changes without weakening desktop behavior.

## 1. Scope Guard

- Changes stay inside mobile-only surfaces unless there is an explicit shared-code reason.
- Desktop navigation, layouts, and flows remain behaviorally unchanged.
- Any shared component changes require a desktop regression check before merge.

## 2. Core Mobile Flows

These must work on-device or simulator before sign-off:

- First-run entry:
  - A signed-in mobile user can reach a team or create one.
  - A user without an active org is not left in a dead end.
- Organization switching:
  - Existing orgs are visible.
  - Switching orgs updates the active workspace and safely recovers when the current project is not available in the new org.
- Project switching:
  - The current project is visible.
  - Other projects are easy to scan and open.
- Agent workflow:
  - A user can find the current project agent.
  - A user can switch between attached agents.
  - A user can create a remote agent.
  - A user can attach an existing remote agent when available.
  - A user can open remote project files without being redirected into another tab.
- On-the-go work loop:
  - A user can chat with the active agent.
  - A user can see task status, execution state, and specs without desktop-only assumptions.
  - A user can preview remote workspace files on mobile when the backing agent exposes them.

## 3. Design Quality

- The mobile path prioritizes fast orientation:
  - Where am I?
  - Which org/project/agent am I in?
  - What should I do next?
- Every screen has one primary job:
  - resume work
  - switch context
  - review work
  - create or attach an agent
  - adjust settings
- Repeated context is removed unless it changes the next action:
  - do not repeat the same org, project, or agent name in multiple headings on one screen
  - do not repeat the same explanation in hero copy, section copy, and button labels
  - do not expose two menu items that open the same mobile destination
- Copy stays mobile-first:
  - headings are short and specific
  - supportive text is optional, not default
  - labels prefer direct verbs and nouns over product marketing language
- Empty and loading states include a useful next step.
- Important actions are reachable in one or two taps from active work views.
- Dense configuration UI does not replace the primary “resume work quickly” path.
- A screen should feel scannable with one thumb:
  - clear visual hierarchy
  - large tap targets
  - no stacked explanatory paragraphs before the primary action

## 4. Regression Checks

- Targeted tests for changed mobile components pass.
- The interface production build passes.
- Native mobile shell builds and launches successfully.
- Manual simulator validation is done after native sync for any UI flow changes.
- Screenshot validation is captured for every reachable changed screen and key flow step.
- Desktop focused E2E or responsive checks pass for any shared routes, shells, or forms touched by the change.

## 5. Sign-Off Gate

Before merge, all of the following must be true:

- Engineering sign-off:
  - Mobile changes are implemented and verified.
  - Desktop behavior has been sanity-checked.
- Design sign-off:
  - UI/UX review confirms the flow is coherent and intentional on mobile.
  - UI/UX review explicitly confirms there is no avoidable redundancy in screen titles, labels, or routes.
- Agentic experience sign-off:
  - Review confirms the mobile app supports meaningful on-the-go remote-agent work.
- Sub-agent sign-off:
  - The UI/UX review agent signs off or lists only non-blocking follow-ups.
  - The agentic-experience review agent signs off or lists only non-blocking follow-ups.

## 6. Current Review Focus

For this branch, priority is:

1. Add a real remote-files surface for mobile project work.
2. Expose attach-existing-agent from project context instead of leaving it route-only.
3. Reuse the shared agent editor for mobile project creation while keeping mobile remote-only.
4. Preserve desktop behavior for all shared shell, routing, and editor code touched by the branch.
5. Keep mobile surfaces simple enough that users do not see the same context repeated in multiple places on one screen.

## 7. Screenshot Proof

Before calling the branch ready, capture screenshots for:

- mobile app switcher
- organization hub with data
- organization hub empty state
- project chat
- project drawer
- tasks/work/specs entry points
- remote files list
- remote file preview
- agent details / skills
- add project agent action sheet
- create remote agent
- attach existing remote agent
- desktop sanity views for any shared code touched
