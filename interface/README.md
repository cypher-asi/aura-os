# Aura Interface

React 19 + TypeScript single-page application served by `aura-os-server` and embedded in the `aura-os-desktop` native shell via WebView.

## Development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. The Vite dev server proxies `/api` and `/ws` to the backend at `http://localhost:3100`.

For the native desktop shell with live frontend updates, start both processes from the repo root:

```bash
./scripts/dev/run-desktop-dev.sh
```

On Windows PowerShell:

```powershell
./scripts/dev/run-desktop-dev.ps1
```

That flow waits for Vite before launching `aura-os-desktop`, and the desktop runtime will auto-attach to the dev server if it appears after startup. Plain debug runs now also try to boot a local Vite server automatically, while the script keeps the desktop shell and frontend locked to the same dev URL from the start.

## Production build

```bash
npm run build
```

Output goes to `dist/`, which the desktop packager bundles into the native app.

## Mobile (Capacitor)

```bash
npm run build:native       # Build web + sync into native shells
npm run cap:open:ios       # Open iOS project in Xcode
npm run cap:open:android   # Open Android project in Android Studio
```

## Tests

```bash
npm run test               # Vitest unit tests
npx playwright test        # E2E tests (requires running backend)
```
