import { pathToFileURL } from "node:url";

export function validateNativeReleaseHost(platform, env = process.env) {
  if (platform !== "ios" && platform !== "android") throw new Error("Expected ios or android");
  const name = `VITE_${platform.toUpperCase()}_DEFAULT_HOST`;
  const host = env[name]?.trim() || env.VITE_NATIVE_DEFAULT_HOST?.trim();
  if (!host) throw new Error(`Set ${name} or VITE_NATIVE_DEFAULT_HOST before building a release`);
  let url;
  try { url = new URL(host); } catch { throw new Error(`${name} must be an HTTPS origin`); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS origin without credentials, a path, or a query`);
  }
  return url.origin;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateNativeReleaseHost(process.argv[2]);
    console.log("Native release API host validated");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
