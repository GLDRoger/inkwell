import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { AlertCircle, CloudOff, FilePlus2, FileText, ImagePlus, Loader2, Map as MapIcon, NotebookPen, Trash2 } from "lucide-react";
import type { Agent, Page, Run } from "@shared/types";
import { isNotFound } from "../lib/api";
import { childrenOf, pageTitle, useAgents, useMap, useMe, usePage, usePages } from "../lib/queries";
import { useCreatePage, useUpdatePage } from "../lib/mutations";
import { openDiaryWith, personColor, useBrowserOnline } from "../lib/ui";
import { useCollab, type CollabStatus } from "./collab";
import { PageEditor } from "./Editor";
import { timeAgo, useNow } from "../lib/time";
import { syncView } from "./syncState";
import { isUntouchedSeed, TitleDraft } from "./title";
import { isDeletePending, subtreeOf, useDeleteWithUndo } from "./deleteUndo";
import { DeleteDialog } from "./DeleteDialog";
import { paintCover, usePainting } from "../lib/media";
import { useServerEvent } from "../lib/events";

/** Exported for tests. */
export function TitleField({ page, onEnter }: { page: Page; onEnter(): void }) {
  const update = useUpdatePage(page.id);
  const [value, setValue] = useState(page.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  const serverTitle = useRef(page.title);
  serverTitle.current = page.title;
  const mutate = useRef(update.mutate);
  mutate.current = update.mutate;
  const [draft] = useState(() => new TitleDraft({ serverTitle: () => serverTitle.current, save: (title) => mutate.current({ title }) }));

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

function SyncPill(props: Omit<ReturnType<typeof useCollab>, "collab">) {
  const browserOnline = useBrowserOnline();
  const busy = props.unsynced > 0 || !props.everSynced || props.status !== "connected";
  // Tick while something is pending, so "Saving…" can turn into "Not saving" and "Reconnecting…" into "Offline".
  const now = useNow(busy ? 1_000 : 60_000);
  const view = syncView({ ...props, now, browserOnline });
  // Edits the server hasn't got yet live only in this tab: ask before a reload or close throws them away.
  const unsaved = props.unsynced > 0;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  return (
    <span className="sync-pill" data-tone={view.tone} role="status" aria-live="polite" title={view.detail}>
      {view.tone === "bad" ? (
        (props.status === "connected" && browserOnline) || props.status === "denied" ? <AlertCircle size={13} aria-hidden /> : <CloudOff size={13} aria-hidden />
      ) : view.tone === "busy" && !props.everSynced ? (
        <Loader2 size={13} className="spin" aria-hidden />
      ) : null}
      <span>{view.label}</span>
      {view.detail && <span className="sr-only">. {view.detail}</span>}
    </span>
  );
}

type Doing = "reading" | "writing" | "thinking";
const DOING: Record<Doing, string> = { reading: "is reading here", writing: "is writing here", thinking: "is thinking here" };

/** Agents working on this page now, from the live runs, with what each is doing (from its footsteps). */
function useWritersHere(pageId: string): { agent: Agent; run: Run; doing: Doing }[] {
  const { data: graph } = useMap();
  const { data: agents } = useAgents();
  const [doing, setDoing] = useState<Record<string, Doing>>({});
  useServerEvent("agent.moved", (e) => {
    if (e.action !== "leaving") setDoing((d) => (d[e.runId] === e.action ? d : { ...d, [e.runId]: e.action as Doing }));
  });
  return useMemo(() => {
    const all = graph?.agents ?? agents ?? [];
    return (graph?.runs ?? [])
      .filter((r) => r.pageId === pageId && (r.status === "running" || r.status === "queued"))
      .flatMap((run) => {
        const agent = all.find((a) => a.id === run.agentId);
        if (!agent) return [];
        const last = run.steps.at(-1);
        const guess: Doing = !last ? "thinking" : /write|edit|create|append|replace|rename|move/i.test(last.tool) ? "writing" : "reading";
        return [{ agent, run, doing: doing[run.id] ?? guess }];
      });
  }, [graph, agents, pageId, doing]);
}

function Children({ page, pages }: { page: Page; pages: Page[] }) {
  const create = useCreatePage();
  const kids = childrenOf(pages, page.id);
  return (
    <section className="children" aria-labelledby="children-title">
      <h2 id="children-title" className="children-title">Inside this page</h2>
      <ul>
        {kids.map((k) => (
          <li key={k.id}>
            <Link to={`/p/${k.id}`} className="child-link">
              <span aria-hidden className="child-icon">{k.icon ?? <FileText size={15} />}</span>
              <span className="child-text">
                <span className="child-title">{pageTitle(k)}</span>
                {k.excerpt && <span className="child-excerpt">{k.excerpt}</span>}
              </span>
            </Link>
          </li>
        ))}
        <li>
          <button type="button" className="child-link child-new" onClick={() => create.mutate({ parentId: page.id })} disabled={create.isPending}>
            <span aria-hidden className="child-icon"><FilePlus2 size={15} /></span>
            <span className="child-title">{kids.length ? "Add another page inside" : "Add a page inside"}</span>
          </button>
        </li>
      </ul>
    </section>
  );
}

/** "Last edited by You · 5 minutes ago", with an agent's name in its colour. */
function Authorship({ page, pages }: { page: Page; pages: Page[] }) {
  const { data: me } = useMe();
  const { data: agents } = useAgents();
  const now = useNow();
  const by = page.updatedBy;
  const color = by.kind === "agent" ? agents?.find((a) => a.id === by.id)?.color : undefined;
  return (
    <p className="page-meta">
      Last edited by{" "}
      {by.kind === "agent" ? (
        <span className="agent-name" style={{ ["--agent" as string]: color ?? "var(--ink-soft)" }}>{by.name}</span>
      ) : by.id === me?.person.id ? (
        "You"
      ) : (
        by.name
      )}
      {" · "}
      <time dateTime={page.updatedAt} title={new Date(page.updatedAt).toLocaleString()}>
        {isUntouchedSeed(page, pages) ? "when your notebook was made" : timeAgo(page.updatedAt, now)}
      </time>
    </p>
  );
}

function PageBody({ page, pages }: { page: Page; pages: Page[] }) {
  const { data: me } = useMe();
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
  const user = useMemo(
    () => ({ name: me?.person.name ?? "You", color: personColor(me?.person.id ?? "me") }),
    [me?.person.name, me?.person.id],
  );
  const inside = subtreeOf(pages, page.id).size - 1;
  const coverLabel = painting ? "Making a cover…" : page.coverUrl ? "New cover" : "Make a cover";

  return (
    <article className="page" aria-labelledby="page-title-label">
      <div className="page-toolbar">
        <SyncPill {...sync} />
        <div className="page-actions">
          <button type="button" className="ghost-button" onClick={() => openDiaryWith("", null)} aria-label="Ask an agent about this page" title="Ask an agent about this page">
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
          <Link to={`/?focus=${page.id}`} className="ghost-button" aria-label="Show on the map" title="Show this page on the map">
            <MapIcon size={15} aria-hidden /> <span>On the map</span>
          </Link>
          <button type="button" className="ghost-button danger" title="Delete this page" aria-label="Delete this page" onClick={() => setConfirming(true)}>
            <Trash2 size={15} aria-hidden />
          </button>
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
        {page.icon && <div className="page-icon" aria-hidden>{page.icon}</div>}
        <span id="page-title-label" className="sr-only">{pageTitle(page)}</span>
        <TitleField page={page} onEnter={focusBody} />
        <Authorship page={page} pages={pages} />
        {writers.length > 0 && (
          <ul className="writers" aria-label="Agents on this page">
            {writers.map(({ agent, doing }) => (
              <li key={agent.id} className="writer" data-doing={doing} style={{ ["--agent" as string]: agent.color }}>
                <span className="writer-nib" aria-hidden />
                <span className="agent-name">{agent.name}</span> {DOING[doing]}
              </li>
            ))}
          </ul>
        )}
      </header>

      {sync.status === "denied" ? (
        <p className="inline-error" role="alert">This page isn't in your notebook, so it can't be edited here.</p>
      ) : collab ? (
        <PageEditor
          pageId={page.id}
          collab={collab}
          synced={sync.synced}
          user={user}
          writerColor={writers.find((w) => w.doing === "writing")?.agent.color ?? writers[0]?.agent.color ?? null}
          onReady={onReady}
        />
      ) : null}

      <Children page={page} pages={pages} />
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
            <button type="button" className="pill-button" onClick={onRetry}>Try again</button>
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
