import { Component, lazy, Suspense, useEffect, type ComponentType, type ReactNode } from "react";
import { Route, Routes, useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { useServerEvents } from "./lib/events";
import { api, isNotFound } from "./lib/api";
import { useMe } from "./lib/queries";
import { getUi, setUi, useUi } from "./lib/ui";
import { TopBar } from "./shell/TopBar";
import { CommandPalette } from "./shell/CommandPalette";
import { ConnectionNotice } from "./shell/ConnectionNotice";
import { Notices } from "./shell/Notices";
import { MapPlaceholder } from "./shell/MapPlaceholder";
import { DiaryPanel } from "./diary/DiaryPanel";

type MapViewProps = { onOpenPage(id: string): void; focusPageId?: string };

// The map lives in ./map (built separately). Until that file exists, the glob is empty and we show a placeholder.
const mapModules = import.meta.glob<{ MapView: ComponentType<MapViewProps> }>("./map/index.tsx");
const loadMap = mapModules["./map/index.tsx"];
const MapView = loadMap ? lazy(() => loadMap().then((m) => ({ default: m.MapView }))) : null;
// The editor stack (Tiptap, Yjs) loads only when a page opens.
const PageView = lazy(() => import("./page/PageView").then((m) => ({ default: m.PageView })));

/** If the map canvas fails to load or crashes, fall back to the page list rather than a blank screen. */
class MapBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[map] failed, showing the page list instead", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function MapRoute() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focusPageId = params.get("focus") ?? undefined;
  const onOpenPage = (id: string) => navigate(`/p/${id}`);
  if (!MapView) return <MapPlaceholder onOpenPage={onOpenPage} />;
  return (
    <MapBoundary fallback={<MapPlaceholder onOpenPage={onOpenPage} />}>
      <Suspense fallback={<div className="map-loading" aria-busy="true" />}>
        <MapView onOpenPage={onOpenPage} focusPageId={focusPageId} />
      </Suspense>
    </MapBoundary>
  );
}

/** Tell the server which page this person is on, so the map can show them. */
function usePresenceReport() {
  const match = useMatch("/p/:id");
  const pageId = match?.params.id ?? null;
  useEffect(() => {
    let stopped = false;
    const send = () =>
      api.presence(pageId).catch((e) => {
        if (isNotFound(e)) stopped = true; // presence isn't built on this server; stay quiet
      });
    void send();
    const timer = setInterval(() => !stopped && void send(), 45_000);
    return () => clearInterval(timer);
  }, [pageId]);
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setUi((s) => ({ paletteOpen: !s.paletteOpen }));
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setUi((s) => ({ diaryOpen: !s.diaryOpen, paletteOpen: false }));
      } else if (e.key === "Escape" && getUi().diaryOpen && !getUi().paletteOpen) {
        const t = e.target as HTMLElement | null;
        if (t?.closest(".diary")) setUi({ diaryOpen: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * The first request creates the visitor's session and workspace. Wait for it
 * before anything else runs, or parallel first requests each mint their own.
 */
export function App() {
  const me = useMe();
  if (me.data) return <Shell />;
  return (
    <div className="session-gate" role={me.error ? "alert" : "status"} aria-busy={!me.error}>
      <p className="session-gate-mark">Inkwell</p>
      {me.error ? (
        <p>
          Couldn't open your notebook. <button className="link-button" onClick={() => me.refetch()}>Try again</button>
        </p>
      ) : (
        <p className="muted">Opening your notebook…</p>
      )}
    </div>
  );
}

function Shell() {
  useServerEvents();
  usePresenceReport();
  useGlobalShortcuts();
  const location = useLocation();
  const onMap = location.pathname === "/";
  const diaryOpen = useUi((s) => s.diaryOpen);

  return (
    <div className="app" data-route={onMap ? "map" : "page"} data-diary={diaryOpen ? "open" : "closed"}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar />
      <main id="main" className="app-main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<MapRoute />} />
          <Route
            path="/p/:id"
            element={
              <Suspense fallback={<div className="page-scroll" aria-busy="true" />}>
                <PageView />
              </Suspense>
            }
          />
          <Route path="*" element={<MapRoute />} />
        </Routes>
      </main>
      <DiaryPanel />
      <CommandPalette />
      <ConnectionNotice />
      <Notices />
    </div>
  );
}
