import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

/**
 * Routes owned by the Chat app. A single `/chat` route covers both the
 * fresh-canvas case and the historical-session case (driven by the
 * `?session=<id>` query string). The route component is lazy because this
 * module is statically imported by the app registry (and therefore lands
 * in the public entry graph): an eager import would pull the full
 * `ChatPanel` bundle into the marketing visitor's first download. The
 * chunk is still shared with the agents and projects apps, so logged-in
 * navigation costs nothing extra.
 */
const ChatAppRoute = lazy(() =>
  import("./components/ChatAppRoute").then((m) => ({ default: m.ChatAppRoute })),
);

export const chatAppRoutes: RouteObject[] = [
  { path: "chat", element: <ChatAppRoute /> },
];
