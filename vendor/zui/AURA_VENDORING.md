# Aura Vendoring Notes

- Upstream repository: `https://github.com/cypher-asi/zui.git`
- Imported branch: `master`
- Imported subtree split: `9e3d587cffb5ca61accbd5ee3ad1ae41dfb6c238`
- Package version in this vendored snapshot: `0.1.4`

## Why this snapshot

Aura needs ZUI to build entirely from within this repository. The latest published npm release available during import was `@cypher-asi/zui@0.1.3`, but that package still referenced `file:../shared`, which would have forced builds to look outside the repo. This vendored snapshot is the first upstream state already compatible with Aura's self-contained build requirement.

## Local Aura integration

- `interface/package.json` installs `@cypher-asi/zui` from `../vendor/zui`
- `interface/package.json` also runs `npm ci --prefix ../vendor/zui --omit=dev` during `postinstall` so the vendored package's runtime dependencies stay local to this repo
- `interface/vite.config.ts`, `interface/tsconfig.app.json`, and `interface/vitest.config.ts` resolve ZUI directly to vendored source
- CI no longer checks out or links an out-of-repo sibling ZUI checkout
