# Aura Interface

React 19 + TypeScript single-page application served by `aura-os-server` and embedded in the `aura-os-desktop` native shell via WebView.

## Development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. The Vite dev server proxies `/api` and `/ws` to the backend at `http://localhost:3100`.

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
