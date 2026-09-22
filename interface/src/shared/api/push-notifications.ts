import { apiFetch } from "./core";
import type { NotificationKind } from "../types/notifications";

export interface PushDeviceRegistration {
  token: string;
  platform: "android" | "ios";
  app_version?: string;
  enabled_kinds: NotificationKind[];
}

export interface PushRegistrationResponse {
  registered: boolean;
  delivery_configured: boolean;
}

export const pushNotificationsApi = {
  registerDevice: (registration: PushDeviceRegistration) =>
    apiFetch<PushRegistrationResponse>("/api/notifications/devices", {
      method: "POST",
      body: JSON.stringify(registration),
      useControlPlane: true,
    }),
  unregisterDevice: (token: string) =>
    apiFetch<void>("/api/notifications/devices", {
      method: "DELETE",
      body: JSON.stringify({ token }),
      useControlPlane: true,
    }),
};
