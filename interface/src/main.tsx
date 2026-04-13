import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@cypher-asi/zui";
import "@fontsource-variable/inter";
import "@cypher-asi/zui/styles";
import "highlight.js/styles/github-dark.min.css";
import "./index.css";
import App from "./App";
import { queryClient } from "./lib/query-client";
import { registerServiceWorker } from "./lib/registerServiceWorker";

registerServiceWorker();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" defaultAccent="purple">
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
