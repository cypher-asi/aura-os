# Performance Wave 0 Baseline

## Deferred Local Stashes

These stashes existed before the performance work began. Do not apply them as
part of Wave 0; inspect them first if future work needs to recover anything.

- `stash@{0}`: `On refactor/f2-shared-bootstrap: wip: f2-shared-bootstrap WIP (interface types -> shared/types refactor)`
- `stash@{1}`: `On main: WIP: frontend and server changes`

Suggested inspection commands:

```bash
git stash show --stat stash@{0}
git stash show -p stash@{0}
git stash show --stat stash@{1}
git stash show -p stash@{1}
```

