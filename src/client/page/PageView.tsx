import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { FilePlus2, FileText, ImagePlus, Loader2, Map as MapIcon, NotebookPen, Trash2 } from "lucide-react";
import type { Page } from "@shared/types";
import { isNotFound } from "../lib/api";
import { childrenOf, pageTitle, usePage, usePages } from "../lib/queries";
import { useCreatePage, useUpdatePage } from "../lib/mutations";
import { openDiaryWith } from "../lib/ui";
import { useDemo } from "../lib/demo";
import { useCollab } from "./collab";
import { Authorship, PageDocument, SyncPill, Writers, useWritersHere } from "./PageDocument";
import { TitleDraft } from "./title";
import { isDeletePending, subtreeOf, useDeleteWithUndo } from "./deleteUndo";
import { DeleteDialog } from "./DeleteDialog";
import { paintCover, usePainting } from "../lib/media";

/** Exported for tests. */
export function TitleField({ page, onEnter, readOnly = false }: { page: Page; onEnter(): void; readOnly?: boolean }) {
  const update = useUpdatePage(page.id);
  const [value, setValue] = useState(page.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  const serverTitle = useRef(page.title);
  serverTitle.current = page.title;
  const mutate = useRef(update.mutate);
  mutate.current = update.mutate;
  const [draft] = useState(
    () =>
      new TitleDraft({
        serverTitle: () => serverTitle.current,
        save: (title) => mutate.current({ title }),
      }),
  );

  // Follow remote renames (an agent retitling the page) unless you're mid-edit.
  useEffect(() => {
    if (!draft.pending) setValue(page.title);
  }, [page.title, draft]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if ((location.state as { fresh?: boolean } | null)?.fresh) ref.current?.focus();
  }, [location.state, page.id]);

  // Leaving the page (Back, a link) or the tab going to the background saves what was typed.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && draft.flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      draft.flush();
    };
  }, [draft]);

  return (
    <textarea
      ref={ref}
      id="page-title"
      className="page-title"
      rows={1}
      value={value}
      placeholder="Untitled"
      aria-label="Page title"
      readOnly={readOnly}
      onBlur={() => draft.flush()}
      onChange={(e) => {
        const next = e.target.value.replace(/\n/g, "");
        setValue(next);
        draft.type(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || (e.key === "ArrowDown" && ref.current?.selectionStart === value.length)) {
          e.preventDefault();
          draft.flush();
          onEnter();
        }
      }}
    />
  );
}

function Children({ page, pages, readOnly }: { page: Page; pages: Page[]; readOnly: boolean }) {
  const create = useCreatePage();
  const kids = childrenOf(pages, page.id);
  return (
    <section className="children" aria-labelledby="children-title">
      <h2 id="children-title" className="children-title">
        Inside this page
      </h2>
      <ul>
        {kids.map((k) => (
          <li key={k.id}>
            <Link to={`/p/${k.id}`} className="child-link">
              <span aria-hidden className="child-icon">
                {k.icon ?? <FileText size={15} />}
              </span>
              <span className="child-text">
                <span className="child-title">{pageTitle(k)}</span>
                {k.excerpt && <span className="child-excerpt">{k.excerpt}</span>}
              </span>
            </Link>
          </li>
        ))}
        {!readOnly && (
          <li>
            <button type="button" className="child-link child-new" onClick={() => create.mutate({ parentId: page.id })} disabled={create.isPending}>
              <span aria-hidden className="child-icon">
                <FilePlus2 size={15} />
              </span>
              <span className="child-title">{kids.length ? "Add another page inside" : "Add a page inside"}</span>
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function PageBody({ page, pages }: { page: Page; pages: Page[] }) {
  // The recorded demo's notebook is only for watching: no typing, renaming or deleting.
  const readOnly = useDemo((s) => s.notebook === "demo");
  const { collab, ...sync } = useCollab(page.id);
  const editorRef = useRef<TiptapEditor | null>(null);
  const focusWhenReady = useRef(false);
  const writers = useWritersHere(page.id);
  const deletePage = useDeleteWithUndo();
  const [confirming, setConfirming] = useState(false);
  const painting = usePainting(page.id);
  const onReady = useCallback((e: TiptapEditor) => {
    editorRef.current = e;
    if (focusWhenReady.current) {
      focusWhenReady.current = false;
      e.commands.focus("start");
    }
  }, []);
  // Enter in the title: go to the body, or as soon as the editor has loaded.
  const focusBody = useCallback(() => {
    const e = editorRef.current;
    if (e && !e.isDestroyed) e.commands.focus("start");
    else focusWhenReady.current = true;
  }, []);
  const inside = subtreeOf(pages, page.id).size - 1;
  const coverLabel = painting ? "Making a cover…" : page.coverUrl ? "New cover" : "Make a cover";

  return (
    <article className="page" aria-labelledby="page-title-label">
      <div className="page-toolbar">
        <SyncPill {...sync} readOnly={readOnly} />
        <div className="page-actions">
          {!readOnly && (
            <>
              <button
                type="button"
                className="ghost-button"
                onClick={() => openDiaryWith("", null)}
                aria-label="Ask an agent about this page"
                title="Ask an agent about this page"
              >
                <NotebookPen size={15} aria-hidden /> <span>Ask an agent</span>
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => void paintCover(page)}
                disabled={painting}
                aria-busy={painting}
                aria-label={coverLabel}
                title={page.coverUrl ? "Make a new cover with Muse Image" : "Make a cover with Muse Image"}
              >
                {painting ? <Loader2 size={15} className="spin" aria-hidden /> : <ImagePlus size={15} aria-hidden />} <span>{coverLabel}</span>
              </button>
            </>
          )}
          <Link to={`/?focus=${page.id}`} className="ghost-button" aria-label="Show on the map" title="Show this page on the map">
            <MapIcon size={15} aria-hidden /> <span>On the map</span>
          </Link>
          {!readOnly && (
            <button type="button" className="ghost-button danger" title="Delete this page" aria-label="Delete this page" onClick={() => setConfirming(true)}>
              <Trash2 size={15} aria-hidden />
            </button>
          )}
        </div>
      </div>
      <DeleteDialog
        open={confirming}
        title={pageTitle(page)}
        inside={inside}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          deletePage(page);
        }}
      />

      <header className="page-head">
        {(page.coverUrl || painting) && (
          <div className="page-cover-frame" data-painting={painting || undefined}>
            {page.coverUrl && <img className="page-cover" src={page.coverUrl} alt="" />}
            {painting && (
              <p className="cover-painting" role="status">
                <Loader2 size={14} className="spin" aria-hidden /> Making a cover with Muse Image…
              </p>
            )}
          </div>
        )}
        {page.icon && (
          <div className="page-icon" aria-hidden>
            {page.icon}
          </div>
        )}
        <span id="page-title-label" className="sr-only">
          {pageTitle(page)}
        </span>
        <TitleField page={page} onEnter={focusBody} readOnly={readOnly} />
        <Authorship page={page} pages={pages} />
        <Writers writers={writers} />
      </header>

      <PageDocument page={page} collab={collab} sync={sync} writers={writers} readOnly={readOnly} onReady={onReady} />

      <Children page={page} pages={pages} readOnly={readOnly} />
    </article>
  );
}

/** A page this visitor can't open: deleted, or from someone else's notebook. */
export function PageMissing({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const notFound = error == null || isNotFound(error);
  useEffect(() => {
    document.title = notFound ? "Not in your notebook · Inkwell" : "Couldn't open this page · Inkwell";
  }, [notFound]);
  return (
    <div className="page-scroll">
      <div className="page missing" role="alert">
        {notFound ? (
          <>
            <h1 className="missing-title">This page isn't in your notebook</h1>
            <p className="missing-body">It was deleted, or the link came from someone else's notebook — each visitor gets their own.</p>
          </>
        ) : (
          <>
            <h1 className="missing-title">Couldn't open this page</h1>
            <p className="missing-body">{(error as Error | null)?.message || "Something went wrong."}</p>
          </>
        )}
        <div className="missing-actions">
          <Link to="/" className="pill-button pill-primary">
            <MapIcon size={15} aria-hidden /> Back to the map
          </Link>
          {!notFound && (
            <button type="button" className="pill-button" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function PageView() {
  const { id = "" } = useParams();
  const { data: page, error, isLoading, refetch } = usePage(id);
  const { data: pages = [] } = usePages();
  const listed = pages.find((p) => p.id === id);
  const current = page ? { ...page, ...(listed ?? {}) } : listed;
  const gone = isDeletePending(id);

  useEffect(() => {
    if (current && !gone) document.title = `${pageTitle(current)} · Inkwell`;
  }, [current?.title, gone]);

  if (current && !error && !gone) {
    return (
      <div className="page-scroll">
        <PageBody key={id} page={current} pages={pages} />
      </div>
    );
  }
  if (isLoading && !gone) {
    return (
      <div className="page-scroll">
        <div className="page page-skeleton" aria-busy="true" aria-label="Loading page">
          <div className="sk sk-title" />
          <div className="sk sk-line" />
          <div className="sk sk-line" />
          <div className="sk sk-line short" />
        </div>
      </div>
    );
  }
  return <PageMissing error={gone ? null : error} onRetry={() => void refetch()} />;
}
