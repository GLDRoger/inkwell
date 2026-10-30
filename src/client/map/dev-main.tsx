/**
 * Dev harness: the map alone, on the fixture notebook, no server needed.
 * Open /map/dev.html?fixture=1 (add &pages=400, &script=0, &theme=dark|light).
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "../theme.css";
import "../styles/page.css";
import { MapView } from "./index";

const params = new URLSearchParams(location.search);
const theme = params.get("theme");
if (theme === "dark" || theme === "light") document.documentElement.style.colorScheme = theme;
if (!params.has("fixture")) {
  params.set("fixture", "1");
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

function Harness() {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <>
      <MapView
        onOpenPage={(id) => {
          setOpened(id);
          setTimeout(() => setOpened(null), 1800);
        }}
        focusPageId={params.get("focus") ?? undefined}
      />
      {opened && <div className="toast">Would open page {opened}</div>}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      {/* The map's photo import navigates; the harness has no real routes. */}
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>,
);
