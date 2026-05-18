/* ------------------------------------------------------------------ */
/*  PartitionRegistry — single source of truth for per-streamKey       */
/*  state lifecycle (migrate on session-id flip, clear on prune).      */
/*                                                                     */
/*  Each per-partition map module owns its state and registers a       */
/*  {name, migrate, clear} record at module load. The migration        */
/*  orchestrator (`migrateChatPartition` in `./migration.ts`) and the  */
/*  stream-store prune sweep (`pruneStreamStore` in `./store.ts`)      */
/*  iterate the registry list rather than calling each helper by      */
/*  name. Adding a new per-partition map means writing one module      */
/*  that registers itself once; the orchestrator and the sweep pick    */
/*  it up automatically — closing the structural footgun where         */
/*  remembering-to-call-each-helper at every flip site caused the      */
/*  Phase-3 asymmetry between project-chat and standalone-agent        */
/*  surfaces.                                                          */
/*                                                                     */
/*  Registrations are independent: no registry may rely on another     */
/*  having run first. Iteration order follows registration order       */
/*  (which in turn follows Node module-resolution order); if a future  */
/*  registry needs deterministic ordering, add a `priority?: number`   */
/*  field rather than relying on import side-effects.                  */
/* ------------------------------------------------------------------ */

/**
 * One registered per-partition map. `migrate` re-keys an entry from
 * `oldKey` to `newKey` (the implementation decides what to do if
 * `newKey` already exists — convention is "destination wins, source
 * drops"); `clear` drops the entry for `key`. Both are no-ops when
 * the underlying map has no entry at the supplied key.
 */
export interface PartitionRegistry {
  readonly name: string;
  migrate(oldKey: string, newKey: string): void;
  clear(key: string): void;
}

const registries: PartitionRegistry[] = [];

/**
 * Register a per-partition map's migrate/clear pair. Idempotent by
 * `name`: re-registering an existing name REPLACES the prior record
 * so a Vite HMR reload or a Vitest module re-evaluation binds the
 * fresh closure (over the new module-level map identity) rather
 * than orphaning the stale one.
 */
export function registerPartitionRegistry(r: PartitionRegistry): void {
  const idx = registries.findIndex((x) => x.name === r.name);
  if (idx >= 0) {
    registries[idx] = r;
    return;
  }
  registries.push(r);
}

/**
 * Re-key every registered partition map from `oldKey` to `newKey`
 * in registration order. Called once by `migrateChatPartition` at
 * each server-driven session-id flip site (the fresh-canvas
 * placeholder → real session id swap on `SessionReady`, and the
 * mid-stream `auto_fork` / `forked_for_context` hand-off).
 *
 * Errors propagate; a half-migrated partition would be worse than
 * surfacing the failure at the flip site.
 */
export function migrateAllPartitions(oldKey: string, newKey: string): void {
  for (const r of registries) r.migrate(oldKey, newKey);
}

/**
 * Drop the entry for `key` from every registered partition map.
 * Called from `pruneStreamStore`'s eviction loop so an evicted
 * partition can't leak its retry timer / cached send payload past
 * its last live handler.
 */
export function clearAllPartitions(key: string): void {
  for (const r of registries) r.clear(key);
}

/**
 * Test-only: drop every registration. Production code never calls
 * this; exposed so a vitest suite exercising the registry shape
 * itself can start from a clean slate.
 */
export function _resetAllPartitionRegistries(): void {
  registries.length = 0;
}

/**
 * Test-only: snapshot the list of registry names in registration
 * order. Useful for sanity-checking that the expected set of
 * per-partition maps is wired up.
 */
export function _listPartitionRegistryNames(): string[] {
  return registries.map((r) => r.name);
}
