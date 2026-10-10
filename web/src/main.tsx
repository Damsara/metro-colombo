import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { ApiError } from "./api";
import { initAnalytics, trackPage } from "./lib/analytics";
import { LanguageProvider } from "./lib/language";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failures, error) =>
        failures < 1 && !(error instanceof ApiError && error.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({ routeTree });

if (initAnalytics(import.meta.env.VITE_GA_MEASUREMENT_ID)) {
  router.subscribe("onResolved", ({ toLocation }) =>
    trackPage(toLocation.pathname),
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
