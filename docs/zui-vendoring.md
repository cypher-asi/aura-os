# ZUI Vendoring

Aura vendors `@cypher-asi/zui` directly into this repository under `vendor/zui`.

## Why

- Builds must stay self-contained and never depend on an out-of-repo sibling checkout or another external source tree.
- The frontend toolchain resolves `@cypher-asi/zui` directly to vendored source, so Vite, TypeScript, and Vitest treat ZUI as repo-local code.
- `interface/package.json` runs a `postinstall` step that installs the vendored ZUI runtime dependencies in place, so the normal `cd interface && npm install` flow remains self-contained.
- We preserve upstream history with `git subtree`, which makes future updates easier to review and merge.

## Current Baseline

- Upstream repository: `https://github.com/cypher-asi/zui.git`
- Imported subtree split: `9e3d587cffb5ca61accbd5ee3ad1ae41dfb6c238`
- Vendored package version at import time: `0.1.4`

The latest published npm release available during vendoring was `@cypher-asi/zui@0.1.3`, but that published package still carried a `file:../shared` dependency and React 18-only peer declarations. Because Aura requires a fully self-contained in-repo build, the vendored baseline uses the first upstream revision that removed those external assumptions.

## Future Updates

Use npm releases as the version signal, but merge the corresponding upstream Git history into the subtree:

```bash
git subtree pull --prefix=vendor/zui https://github.com/cypher-asi/zui.git master
cd interface
npm install
npm run build
npm test
```

After each update:

- record the imported upstream commit and intended npm release in `vendor/zui/AURA_VENDORING.md`
- refresh `interface/package-lock.json`
- verify that Aura still builds without any dependency on a sibling checkout
