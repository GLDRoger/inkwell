import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, FilePlus2, FileText, Feather, Map as MapIcon, SunMoon } from "lucide-react";
import type { Page } from "@shared/types";
import { api, isNotFound } from "../lib/api";
import { keys, pageTitle, usePages } from "../lib/queries";
import { useCreatePage } from "../lib/mutations";
import { openDiaryWith, setUi, useUi } from "../lib/ui";

interface Item {
  id: string;
  section: "Pages" | "Actions";
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

/** Rank pages by title match: prefix, then word-start, then substring. Exported for tests. */
export function rankPages(pages: Page[], q: string, limit = 8): Page[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...pages].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
  const scored: [number, Page][] = [];
  for (const p of pages) {
    const t = pageTitle(p).toLowerCase();
    const s = t.startsWith(needle) ? 0 : t.split(/\s+/).some((w) => w.startsWith(needle)) ? 1 : t.includes(needle) ? 2 : -1;
    if (s >= 0) scored.push([s, p]);
  }
  return scored.sort((a, b) => a[0] - b[0] || pageTitle(a[1]).localeCompare(pageTitle(b[1]))).slice(0, limit).map((x) => x[1]);
}

function toggleTheme() {
  const root = document.documentElement;
  const current = root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
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
    const out: Item[] = [];
    const seen = new Set<string>();
    const go = (id: string) => () => {
      close();
      navigate(`/p/${id}`);
    };
    for (const p of rankPages(pages, q, q ? 6 : 5)) {
      seen.add(p.id);
      out.push({ id: `page-${p.id}`, section: "Pages", label: `${p.icon ? p.icon + " " : ""}${pageTitle(p)}`, icon: <FileText size={16} />, run: go(p.id) });
    }
    for (const hit of search.data ?? []) {
      if (seen.has(hit.page.id) || out.length >= 10) continue;
      seen.add(hit.page.id);
      out.push({
        id: `page-${hit.page.id}`,
        section: "Pages",
        label: pageTitle(hit.page),
        detail: hit.snippet,
        icon: <FileText size={16} />,
        run: go(hit.page.id),
      });
    }
    const text = q.trim();
    if (text) {
      out.push({
        id: "ask",
        section: "Actions",
        label: <>Ask an agent: <em>“{text}”</em></>,
        icon: <Feather size={16} />,
        run: () => openDiaryWith(text),
      });
      out.push({
        id: "new-titled",
        section: "Actions",
        label: <>New page <em>“{text}”</em></>,
        icon: <FilePlus2 size={16} />,
        run: () => {
          close();
          create.mutate({ title: text });
        },
      });
    } else {
      out.push({ id: "diary", section: "Actions", label: "Write in the diary", icon: <Feather size={16} />, run: () => setUi({ paletteOpen: false, diaryOpen: true }) });
      out.push({ id: "new", section: "Actions", label: "New page", icon: <FilePlus2 size={16} />, run: () => (close(), create.mutate({})) });
    }
    out.push({ id: "map", section: "Actions", label: "Open the map", icon: <MapIcon size={16} />, run: () => (close(), navigate("/")) });
    out.push({ id: "theme", section: "Actions", label: "Switch light / dark", icon: <SunMoon size={16} />, run: () => (toggleTheme(), close()) });
    return out;
  }, [pages, q, search.data]);

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
          placeholder="Search pages, or ask an agent…"
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
        {search.isFetching && <div className="palette-status" aria-live="polite">Searching…</div>}
      </div>
    </dialog>
  );
}
