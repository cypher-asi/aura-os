import { ensureProfileStatusRealtimeInitialized } from "./profile-status-store";
import { initFollowStoreAuthSync } from "./follow-store";

/** Registers profile/follow realtime hooks once the user is authenticated (not at module load). */
export function bootstrapAuthenticatedShellStores(): void {
  ensureProfileStatusRealtimeInitialized();
  initFollowStoreAuthSync();
}
