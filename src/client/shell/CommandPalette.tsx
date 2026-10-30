import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CornerDownLeft,
  FilePlus2,
  FileText,
  ImagePlus,
  Info,
  Locate,
  Map as MapIcon,
  MessageSquareText,
  Moon,
  NotebookPen,
  ScanText,
  BookOpen,
  Sun,
} from "lucide-react";
import { api, isNotFound } from "../lib/api";
import { keys, pageTitle, usePages } from "../lib/queries";
import { useCreatePage } from "../lib/mutations";
import { openDiaryWith, setUi, useUi } from "../lib/ui";
import { paintCover, usePhotoImport } from "../lib/media";
import { showWelcomeAgain } from "./About";
import { actionDefs, entryKey, paletteEntries, type ActionId, type Section } from "./paletteModel";

interface Item {
  id: string;
  section: Section;
  label: ReactNode;
  detail?: ReactNode;
  icon: ReactNode;
  run(): void;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Phone-width screens get the short placeholder, so it isn't cut off mid-word. */
function useNarrow(): boolean {
  const query = "(max-width: 520px)";
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

const currentTheme = (): "light" | "dark" => {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

function toggleTheme() {
  const root = document.documentElement;
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  localStorage.setItem("inkwell-theme", next);
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const create = useCreatePage();
  const { data: pages = [] } = usePages();
  const debounced = useDebounced(q.trim(), 160);
  const importPhoto = usePhotoImport();
  const onPage = useMatch("/p/:id")?.params.id;
  const onMap = useLocation().pathname === "/";
  const narrow = useNarrow();

  const search = useQuery({
    queryKey: keys.search(debounced),
    queryFn: ({ signal }) => api.search(debounced, signal),
    enabled: open && debounced.length > 1,
    retry: (n, e) => !isNotFound(e) && n < 1,
    staleTime: 10_000,
  });

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setIndex(0);
      d.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && d.open) d.close();
  }, [open]);

  const close = () => setUi({ paletteOpen: false });

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const go = (path: string) => () => {
      close();
      navigate(path);
    };
    const here = onPage ? pages.find((p) => p.id === onPage) : undefined;
    const runAction: Record<ActionId, () => void> = {
      diary: () => setUi({ paletteOpen: false, diaryOpen: true }),
      new: () => (close(), create.mutate({})),
      map: go("/"),
      photo: () => (close(), importPhoto()),
      cover: () => (close(), here && void paintCover(here)),
      theme: () => (toggleTheme(), close()),
      about: () => (close(), navigate("/"), setUi({ aboutOpen: true })),
      welcome: () => (close(), showWelcomeAgain()),
    };
    const ACTION_ICONS: Record<ActionId, ReactNode> = {
      diary: <NotebookPen size={16} />,
      new: <FilePlus2 size={16} />,
      map: <MapIcon size={16} />,
      photo: <ScanText size={16} />,
      cover: <ImagePlus size={16} />,
      theme: currentTheme() === "dark" ? <Sun size={16} /> : <Moon size={16} />,
      about: <Info size={16} />,
      welcome: <BookOpen size={16} />,
    };
    const entries = paletteEntries({
      q,
      pages,
      hits: debounced === q.trim() ? search.data : undefined,
      actions: actionDefs({ theme: currentTheme(), here, onMap }),
    });
    return entries.map((e): Item => {
      const id = entryKey(e);
      switch (e.kind) {
        case "page":
          return {
            id,
            section: e.section,
            label: `${e.page.icon ? e.page.icon + " " : ""}${pageTitle(e.page)}`,
            detail: e.detail,
            icon: <FileText size={16} />,
            run: go(`/p/${e.page.id}`),
          };
        case "show-on-map":
          return { id, section: e.section, label: <>Show <em>“{pageTitle(e.page)}”</em> on the map</>, icon: <Locate size={16} />, run: go(`/?focus=${e.page.id}`) };
        case "action":
          return { id, section: e.section, label: e.action.label, icon: ACTION_ICONS[e.action.id], run: runAction[e.action.id] };
        case "ask":
          return { id, section: e.section, label: <>Ask an agent: <em>“{e.text}”</em></>, icon: <MessageSquareText size={16} />, run: () => openDiaryWith(e.text) };
        case "new-titled":
          return {
            id,
            section: e.section,
            label: <>New page called <em>“{e.text}”</em></>,
            icon: <FilePlus2 size={16} />,
            run: () => (close(), create.mutate({ title: e.text })),
          };
      }
    });
  }, [open, pages, q, debounced, search.data, onPage, onMap, importPhoto]);

  useEffect(() => setIndex(0), [q]);
  const active = items[Math.min(index, items.length - 1)];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter" && active) {
      e.preventDefault();
      active.run();
    }
  };

  useEffect(() => {
    document.getElementById(`cmd-${active?.id}`)?.scrollIntoView({ block: "nearest" });
  }, [active?.id]);

  let lastSection = "";
  return (
    <dialog
      ref={dialogRef}
      className="palette"
      aria-label="Search and commands"
      onClose={close}
      onClick={(e) => e.target === dialogRef.current && close()}
    >
      <div className="palette-box">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={narrow ? "Search or ask an agent…" : "Search pages and actions, or ask an agent…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={active ? `cmd-${active.id}` : undefined}
          aria-autocomplete="list"
        />
        <ul id="palette-list" role="listbox" className="palette-list" aria-label="Results">
          {items.map((item, i) => {
            const header = item.section !== lastSection ? item.section : null;
            lastSection = item.section;
            return (
              <li key={item.id} role="presentation">
                {header && <div className="palette-section" aria-hidden>{header}</div>}
                <div
                  id={`cmd-${item.id}`}
                  role="option"
                  aria-selected={item === active}
                  className="palette-item"
                  onMouseMove={() => setIndex(i)}
                  onClick={() => item.run()}
                >
                  <span className="palette-icon" aria-hidden>{item.icon}</span>
                  <span className="palette-text">
                    <span className="palette-label">{item.label}</span>
                    {item.detail && <span className="palette-detail">{item.detail}</span>}
                  </span>
                  {item === active && <CornerDownLeft className="palette-enter" size={14} aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="palette-status" aria-live="polite">
          {search.isFetching ? "Searching inside your pages…" : <><kbd>↑</kbd> <kbd>↓</kbd> to choose, <kbd>Enter</kbd> to open</>}
        </div>
      </div>
    </dialog>
  );
}
