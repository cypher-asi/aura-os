import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "tech.zero.aura",
  appName: "AURA",
  // Ship the bundled Vite build inside the native shell rather than pointing
  // Capacitor at a hosted URL. The backend/API host is configured separately.
  webDir: "dist",
};

export default config;
