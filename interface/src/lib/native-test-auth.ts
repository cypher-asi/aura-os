import type { AuthSession } from "../shared/types";
import { resolveApiUrl } from "./host-config";
import { getStoredSession, hydrateStoredAuth, setStoredAuth } from "./auth-token";
import { isNativeRuntime } from "./native-runtime";

const nativeTestAccessToken = import.meta.env.VITE_NATIVE_TEST_ACCESS_TOKEN?.trim() ?? "";

function shouldBootstrapNativeTestAuth(): boolean {
  return isNativeRuntime() && nativeTestAccessToken.length > 0;
}

export async function bootstrapNativeTestAuth(): Promise<boolean> {
  if (!shouldBootstrapNativeTestAuth()) return false;
  await hydrateStoredAuth();
  if (getStoredSession()?.access_token) return false;

  const response = await fetch(resolveApiUrl("/api/auth/import-access-token"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ access_token: nativeTestAccessToken }),
  });

  if (!response.ok) {
    throw new Error(`Native test auth import failed with ${response.status}`);
  }

  const session = await response.json() as AuthSession;
  await setStoredAuth(session);
  return true;
}
