import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { ApiError } from "./api";
import { ConsentPrompt } from "./components/ConsentPrompt";
import { trackPage } from "./lib/analytics";
import { ConsentProvider } from "./lib/consent";
import { listenForKonami } from "./lib/konami";
import { LanguageProvider } from "./lib/language";
import { routeTree } from "./routeTree.gen";
import producerTag from "./assets/metro-boomin.mp3";
import "./styles.css";

listenForKonami(() => void new Audio(producerTag).play().catch(() => {}));

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

// A no-op until the visitor allows analytics.
router.subscribe("onResolved", ({ toLocation }) =>
  trackPage(toLocation.pathname),
);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <ConsentProvider measurementId={import.meta.env.VITE_GA_MEASUREMENT_ID}>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
        <ConsentPrompt />
      </ConsentProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
