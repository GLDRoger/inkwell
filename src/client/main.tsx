import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { emit } from "./lib/events";
import "./theme.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/page.css";
import "./styles/diary.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 15_000 } },
});

const saved = localStorage.getItem("inkwell-theme");
if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;

// Dev only: push fake ServerEvents from the console or a test script, e.g. __inkwell.emit({type: "diary.delta", ...}).
if (import.meta.env.DEV) Object.assign(window, { __inkwell: { emit } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
