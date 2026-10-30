import { Component, lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Route, Routes, useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useServerEvents } from "./lib/events";
import { api, isNotFound } from "./lib/api";
import { keys, useMe, usePages } from "./lib/queries";
import { getUi, setUi, useUi } from "./lib/ui";
import { TopBar } from "./shell/TopBar";
import { CommandPalette } from "./shell/CommandPalette";
import { Notices } from "./shell/Notices";
import { Mark } from "./shell/Mark";
import { Welcome, type WelcomeChoice } from "./welcome/Welcome";
import { hasSeenWelcome, markWelcomeSeen, shouldShowWelcome, withoutWelcomeParam } from "./welcome/show";
import { MapPlaceholder } from "./shell/MapPlaceholder";
import { NotFound } from "./shell/NotFound";
import { shortcutFor } from "./shell/shortcuts";
import { DiaryPanel } from "./diary/DiaryPanel";
import { DemoBar } from "./shell/DemoBar";
import { Guide } from "./guide/Guide";
import { KeyDialog } from "./key/KeyDialog";
import { getDemo, useDemo } from "./lib/demo";
import { startDemo, syncDemo, tryItYourself } from "./lib/demo-flow";
import { setMeSource, type MeWithModels } from "./lib/media";

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

/**
 * Tell the server which page this person is on, so the map can show them.
 * Only pages that are really in this notebook: a not-found or foreign link
 * reports "on the map" instead of a page the server would reject.
 */
function usePresenceReport() {
  const match = useMatch("/p/:id");
  const { data: pages } = usePages();
  const id = match?.params.id ?? null;
  const pageId = id && pages?.some((p) => p.id === id) ? id : null;
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

function useGlobalShortcuts(welcome: boolean) {
  const welcomeRef = useRef(welcome);
  welcomeRef.current = welcome;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = getUi();
      const t = e.target as HTMLElement | null;
      const action = shortcutFor(e, { welcome: welcomeRef.current, diaryOpen: ui.diaryOpen, paletteOpen: ui.paletteOpen, inDiary: !!t?.closest?.(".diary") });
      if (action === "palette") {
        e.preventDefault();
        setUi((s) => ({ paletteOpen: !s.paletteOpen }));
      } else if (action === "diary") {
        e.preventDefault();
        setUi((s) => ({ diaryOpen: !s.diaryOpen, paletteOpen: false }));
      } else if (action === "close-diary") setUi({ diaryOpen: false });
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
  const welcome = useWelcome();
  return (
    <>
      {me.data ? <Shell welcome={welcome.phase} /> : <SessionGate me={me} />}
      {welcome.phase && <Welcome onLeave={welcome.leave} onDone={welcome.done} />}
    </>
  );
}

/** First visit only (see welcome/show.ts); the map loads underneath while it plays. */
function useWelcome() {
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [phase, setPhase] = useState<"open" | "leaving" | null>(() =>
    shouldShowWelcome({
      pathname: location.pathname,
      search: location.search,
      seen: hasSeenWelcome(),
      automated: navigator.webdriver,
    })
      ? "open"
      : null,
  );
  return {
    phase,
    leave: (choice: WelcomeChoice) => {
      markWelcomeSeen();
      setPhase("leaving");
      // The demo starts setting up while the welcome leaves; the guide waits for it to go.
      if (choice === "watch") void startDemo(client);
      else tryItYourself(client);
    },
    done: () => {
      setPhase(null);
      if (new URLSearchParams(location.search).has("welcome"))
        navigate({ pathname: location.pathname, search: withoutWelcomeParam(location.search) }, { replace: true });
    },
  };
}

function SessionGate({ me }: { me: ReturnType<typeof useMe> }) {
  return (
    <div className="session-gate" role={me.error ? "alert" : "status"} aria-busy={!me.error}>
      <p className="session-gate-mark"><Mark size={36} /></p>
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

/** Catch up with the demo on a reload mid-demo, and whenever its stream reopens. */
function useDemoSync() {
  const client = useQueryClient();
  useEffect(() => {
    setMeSource(() => client.getQueryData<MeWithModels>(keys.me));
    if (getDemo().notebook === "demo") void syncDemo(client);
  }, [client]);
  return (notebook: string) => notebook === "demo" && void syncDemo(client);
}

function Shell({ welcome }: { welcome: "open" | "leaving" | null }) {
  const onStreamOpen = useDemoSync();
  useServerEvents(onStreamOpen);
  usePresenceReport();
  const notebook = useDemo((s) => s.notebook);
  const guide = useUi((s) => s.guideOpen ?? false);
  useGlobalShortcuts(welcome != null);
  const location = useLocation();
  const onMap = location.pathname === "/";
  const diaryOpen = useUi((s) => s.diaryOpen);

  return (
    <div
      className="app"
      data-route={onMap ? "map" : "page"}
      data-diary={diaryOpen ? "open" : "closed"}
      data-welcome={welcome ?? undefined}
      data-notebook={notebook}
      data-guide={guide ? "open" : undefined}
      inert={welcome != null}
    >
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
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {/* One diary per notebook: switching starts it fresh, so conversations never mix. */}
      <DiaryPanel key={notebook} />
      <DemoBar />
      <CommandPalette />
      <Notices />
      {welcome == null && <Guide />}
      <KeyDialog />
    </div>
  );
}
