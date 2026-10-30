import { Link, useMatch } from "react-router-dom";
import { ChevronRight, Map as MapIcon, NotebookPen, Search } from "lucide-react";
import { ancestorsOf, pageTitle, useMap, useMe, usePages } from "../lib/queries";
import { usePresence } from "../lib/events";
import { isMac, personColor, setUi, useUi } from "../lib/ui";
import { BrandMenu } from "./About";

function Breadcrumbs({ id }: { id: string }) {
  const { data: pages } = usePages();
  if (!pages) return null;
  const current = pages.find((p) => p.id === id);
  const trail = ancestorsOf(pages, id);
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {trail.map((p) => (
          <li key={p.id}>
            <Link to={`/p/${p.id}`}>{p.icon ? `${p.icon} ` : ""}{pageTitle(p)}</Link>
            <ChevronRight aria-hidden size={14} />
          </li>
        ))}
        {current && (
          <li aria-current="page">
            <span>{current.icon ? `${current.icon} ` : ""}{pageTitle(current)}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}

function People() {
  const people = usePresence();
  const { data: me } = useMe();
  const others = people.filter((p) => p.id !== me?.person.id);
  if (!others.length) return null;
  const shown = others.slice(0, 3);
  return (
    <div className="people" aria-label={`${others.length} other ${others.length === 1 ? "person" : "people"} here`}>
      {shown.map((p) => (
        <span key={p.id} className="person-dot" style={{ background: personColor(p.id) }} title={p.name}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {others.length > 3 && <span className="person-more">+{others.length - 3}</span>}
    </div>
  );
}

export function TopBar() {
  const pageMatch = useMatch("/p/:id");
  const diaryOpen = useUi((s) => s.diaryOpen);
  const { data: graph } = useMap();
  const working = graph?.runs.some((r) => r.status === "running" || r.status === "queued") ?? false;
  const mod = isMac() ? "⌘" : "Ctrl ";

  return (
    <header className="topbar">
      <div className="topbar-start">
        {pageMatch ? (
          <>
            <Link
              to={`/?focus=${pageMatch.params.id}`}
              className="icon-button"
              aria-label="Back to the map"
              title="Back to the map"
            >
              <MapIcon size={18} aria-hidden />
            </Link>
            <Breadcrumbs id={pageMatch.params.id!} />
          </>
        ) : (
          <BrandMenu />
        )}
      </div>
      <div className="topbar-center">
        <button
          type="button"
          className="search-trigger"
          aria-label="Search your pages or ask an agent"
          aria-keyshortcuts="Meta+K Control+K"
          onClick={() => setUi({ paletteOpen: true })}
        >
          <Search size={16} aria-hidden />
          <span className="search-trigger-label">Search your pages or ask an agent…</span>
          <kbd aria-hidden>{mod}K</kbd>
        </button>
      </div>
      <div className="topbar-end">
        <People />
        <button
          type="button"
          className="quill-button"
          aria-pressed={diaryOpen}
          aria-label={diaryOpen ? "Close the diary" : "Open the diary"}
          title={`The diary (${mod}J)`}
          onClick={() => setUi((s) => ({ diaryOpen: !s.diaryOpen }))}
        >
          <NotebookPen size={16} aria-hidden />
          <span className="quill-label">Diary</span>
          {working && <span className="working-dot" aria-label="An agent is working" />}
        </button>
      </div>
    </header>
  );
}
