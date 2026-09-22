import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ActionPerformed,
  Token,
} from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import { api } from "../api/client";
import { getAppVersion } from "../lib/build-info";
import { inferNativePlatform, isNativeRuntime } from "../shared/lib/native-runtime";
import type { NotificationKind } from "../shared/types/notifications";
import { useAuthStore } from "../stores/auth-store";
import { useNotificationPreferencesStore } from "../stores/notification-preferences-store";

const ANDROID_CHANNEL_ID = "aura_agent_updates";

interface AuraPushConfigPlugin {
  isConfigured(): Promise<{ configured: boolean }>;
}

interface NativePushRuntime {
  PushNotifications: (typeof import("@capacitor/push-notifications"))["PushNotifications"];
  AuraPushConfig: AuraPushConfigPlugin;
}

let nativePushRuntimePromise: Promise<NativePushRuntime> | null = null;

function loadNativePushRuntime(): Promise<NativePushRuntime> {
  nativePushRuntimePromise ??= Promise.all([
    import("@capacitor/push-notifications"),
    import("@capacitor/core"),
  ]).then(([{ PushNotifications }, { registerPlugin }]) => ({
    PushNotifications,
    AuraPushConfig: registerPlugin<AuraPushConfigPlugin>("AuraPushConfig"),
  }));
  return nativePushRuntimePromise;
}

export function useNativePushNotifications(): void {
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.user?.user_id ?? null);

  useEffect(() => {
    const platform = inferNativePlatform();
    if (!userId || !isNativeRuntime() || !platform) return;

    let disposed = false;
    let token: string | null = null;
    const handles: PluginListenerHandle[] = [];

    const syncRegistration = async (nextToken: string) => {
      if (disposed) return;
      const preferences = useNotificationPreferencesStore.getState().preferences;
      const enabledKinds = Object.entries(preferences.types)
        .filter(([, enabled]) => preferences.enabled && enabled)
        .map(([kind]) => kind as NotificationKind);
      try {
        await api.pushNotifications.registerDevice({
          token: nextToken,
          platform,
          app_version: getAppVersion(),
          enabled_kinds: enabledKinds,
        });
      } catch {
        // Registration is retried on the next native token refresh, login,
        // or notification-preference change. It must never block app boot.
      }
    };

    const install = async () => {
      // Loading Capacitor plugins lazily keeps browser startup independent of
      // the native bridge and avoids mutating browser/test shims at module load.
      const { PushNotifications, AuraPushConfig } = await loadNativePushRuntime();

      handles.push(
        await PushNotifications.addListener("registration", (next: Token) => {
          token = next.value;
          void syncRegistration(next.value);
        }),
      );
      handles.push(
        await PushNotifications.addListener("registrationError", () => {
          token = null;
        }),
      );
      handles.push(
        await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (action: ActionPerformed) => {
            const route = extractInternalPushRoute(action.notification.data);
            if (route) navigate(route);
          },
        ),
      );

      if (platform === "android") {
        const { configured } = await AuraPushConfig.isConfigured();
        if (!configured) return;
        await PushNotifications.createChannel({
          id: ANDROID_CHANNEL_ID,
          name: "Agent updates",
          description: "Agent completions, failures, and requests for approval",
          importance: 4,
          visibility: 1,
          vibration: true,
        });
      }

      const checked = await PushNotifications.checkPermissions();
      const permission =
        checked.receive === "prompt"
          ? await PushNotifications.requestPermissions()
          : checked;
      if (permission.receive === "granted") {
        await PushNotifications.register();
      }
    };

    const unsubscribePreferences = useNotificationPreferencesStore.subscribe(() => {
      if (token) void syncRegistration(token);
    });

    void install().catch(() => {
      // Native notification setup must never prevent the rest of the app
      // from booting.
    });

    return () => {
      disposed = true;
      unsubscribePreferences();
      handles.forEach((handle) => void handle.remove());
      if (token) {
        void api.pushNotifications.unregisterDevice(token).catch(() => {
          // A stale registration is harmless until the next retry, but logout
          // must make a best effort to stop notifications for the old account.
        });
      }
    };
  }, [navigate, userId]);
}

export function extractInternalPushRoute(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const route = (data as Record<string, unknown>).route;
  if (typeof route !== "string") return null;
  const value = route.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://aura.invalid");
    if (url.origin !== "https://aura.invalid") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
