import type { CapacitorConfig } from "@capacitor/cli";

const nativeDefaultHost = process.env.VITE_NATIVE_DEFAULT_HOST ?? null;
const androidDefaultHost = process.env.VITE_ANDROID_DEFAULT_HOST ?? nativeDefaultHost;
const androidNeedsHttpDevOrigin = Boolean(androidDefaultHost && androidDefaultHost.startsWith("http://"));

const config: CapacitorConfig = {
  appId: "tech.zero.aura",
  appName: "AURA",
  // Ship the bundled Vite build inside the native shell rather than pointing
  // Capacitor at a hosted URL. The backend/API host is configured separately.
  webDir: "dist",
  // Capacitor Android shells load the bundled app from a local scheme. When we
  // point debug builds at an http:// host like 10.0.2.2, align the Android
  // scheme and cleartext policy so local API + websocket traffic keeps working.
  server: androidNeedsHttpDevOrigin
    ? {
        androidScheme: "http",
        cleartext: true,
      }
    : undefined,
};

export default config;
