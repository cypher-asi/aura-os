# Desktop Regression Signoff

## Desktop Route Pass 2026-04-26

Purpose: prove that the mobile extraction did not cause the desktop app to render mobile shell/navigation. This pass used the Codex in-app browser against `http://127.0.0.1:5173` after restarting the local Vite dev server.

Acceptance criteria for each route:

- Authenticated desktop app renders, not `/login`.
- Desktop shell chrome is present.
- Mobile-only chrome is absent: no `Project sections`, `More project sections`, `Back to agents`, or `Create Remote Agent` mobile affordances.

| Route | Final URL | Status | Desktop signal |
| --- | --- | --- | --- |
| Agents detail chat | `/agents/1ed0fbf8-3dd0-4546-88a0-c3b80d48d56a` | Passed | `Agents main panel` |
| Agents index | `/agents` | Passed | `Agents main panel` |
| Projects home | `/projects` | Passed | `Projects main panel` |
| Project agents | `/projects/923783b9-a8df-41ee-bf0f-c807a19bea5d/agents` | Passed | `Projects main panel` |
| Project files | `/projects/923783b9-a8df-41ee-bf0f-c807a19bea5d/files` | Passed | `Projects main panel` |
| Project tasks | `/projects/923783b9-a8df-41ee-bf0f-c807a19bea5d/tasks` | Passed | `Projects main panel` |
| Project run/work | `/projects/923783b9-a8df-41ee-bf0f-c807a19bea5d/work` | Passed | `Projects main panel` |
| Project process | `/projects/923783b9-a8df-41ee-bf0f-c807a19bea5d/process` | Passed | `Projects main panel` |
| Project stats | `/projects/923783b9-a8df-41ee-bf0f-c807a19bea5d/stats` | Passed | `Projects main panel` |
| Tasks app | `/tasks` | Passed | Desktop shell controls |
| Process app | `/process` | Passed | Desktop shell controls |
| Feed | `/feed` | Passed | `Feed main panel` |
| Profile | `/profile` | Passed | `Profile main panel` |
| Integrations | `/integrations` | Passed | `Integrations main panel` |
| Settings | `/projects/settings` | Passed after fix | Desktop `Settings`/`About`/`.env.example` content |

Visual evidence:

- `/tmp/aura-desktop-live-proof.png`

Notes:

- The in-app browser screenshot API timed out, so the visual artifact was captured with the OS screenshot tool.
- The screenshot shows the desktop Settings route with desktop rail, toolbar/taskbar, and side panels. It does not show mobile project tabs or mobile drawer chrome.
- This pass proves desktop shell/layout integrity after mobile extraction. It does not exercise side-effectful actions such as creating agents, saving settings, or sending messages.

## Settings Regression Follow-Up 2026-04-26

The first desktop pass was too shallow for `/projects/settings`: it verified desktop shell chrome but missed that the shared `SettingsView` content had been changed to the mobile AURA settings surface.

Checked against `main`:

- `main` already has `/projects/settings`, but it renders the desktop `Page`/`Panel` Settings screen with `Settings`, `Configuration status`, `About`, and `.env.example` copy.
- This branch had changed that shared screen to the mobile production settings screen.

Fix:

- Restored desktop `interface/src/views/SettingsView` to the main desktop layout.
- Moved the mobile production settings surface to `interface/src/mobile/screens/MobileSettingsView`.
- Changed `/projects/settings` to render desktop or mobile settings through an explicit `isMobileLayout` route switch.

Verification:

- `npm test -- --run src/views/SettingsView/SettingsView.test.tsx src/mobile/mobile-boundary.test.ts` passed.
- `npm run build` passed.
- Live desktop browser check at `/projects/settings` confirmed desktop content is back: `Settings`, `About`, `.env.example`; mobile `Remote agent workspace` header is absent.

## Final Desktop/Mobile Browser Matrix 2026-04-26

Purpose: rerun a route-by-route screenshot matrix after the settings regression fix, using an authenticated Playwright fixture against `http://127.0.0.1:5173`.

Coverage:

- Desktop screenshots: settings, agents index, agent chat, projects redirect/chat, project agents, files, tasks, run, process, stats, feed, profile, integrations.
- Mobile screenshots: project agents, agent chat, files, tasks, run, process, stats, settings.
- Each route checked that it did not redirect to `/login`, rendered expected route content, and did not leak the opposite platform's settings/navigation copy.

Result:

- Passed: 21/21 routes.
- Screenshot artifacts: `/tmp/aura-final-regression/*.png`
- JSON report: `/tmp/aura-final-regression/report.json`

Commands:

- `node /tmp/aura-final-visual-regression.mjs`
- `npm test -- --run src/views/SettingsView/SettingsView.test.tsx src/mobile/mobile-boundary.test.ts src/mobile/shell/MobileShell.test.tsx src/mobile/chat/MobileChatPanel.test.tsx`
- `npm test -- --run src/components/ChatPanel/ChatPanel.test.tsx src/components/ChatInputBar/ChatInputBar.test.tsx src/components/FileExplorer/FileExplorer.test.tsx src/views/ProjectWorkView/ProjectWorkView.test.tsx src/views/ProjectTasksView/ProjectTasksView.test.tsx src/views/ProjectFilesView/ProjectFilesView.test.tsx`
- `npm run build`
