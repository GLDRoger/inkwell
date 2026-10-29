import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { CloudOff, Feather, FilePlus2, FileText, Loader2, Map as MapIcon, Trash2 } from "lucide-react";
import type { Agent, Page, Run } from "@shared/types";
import { isNotFound } from "../lib/api";
import { childrenOf, pageTitle, useAgents, useMap, useMe, usePage, usePages } from "../lib/queries";
import { useCreatePage, useDeletePage, useUpdatePage } from "../lib/mutations";
import { openDiaryWith, personColor } from "../lib/ui";
import { useCollab, type CollabStatus } from "./collab";
import { PageEditor } from "./Editor";
import { timeAgo } from "../lib/time";

function TitleField({ page, onEnter }: { page: Page; onEnter(): void }) {
  const update = useUpdatePage(page.id);
  const [value, setValue] = useState(page.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const location = useLocation();

  // Follow remote renames (an agent retitling the page) unless you're typing.
  useEffect(() => {
    if (!focused.current) setValue(page.title);
  }, [page.title]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if ((location.state as { fresh?: boolean } | null)?.fresh) ref.current?.focus();
  }, [location.state, page.id]);

  const save = (title: string) => {
    clearTimeout(timer.current);
    if (title !== page.title) update.mutate({ title });
  };

  return (
    <textarea
      ref={ref}
      className="page-title"
      rows={1}
      value={value}
      placeholder="Untitled"
      aria-label="Page title"
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        save(value);
      }}
      onChange={(e) => {
        const next = e.target.value.replace(/\n/g, "");
        setValue(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => save(next), 600);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || (e.key === "ArrowDown" && ref.current?.selectionStart === value.length)) {
          e.preventDefault();
          save(value);
          onEnter();
        }
      }}
    />
  );
}

function SyncPill({ status, synced, unsynced }: { status: CollabStatus; synced: boolean; unsynced: number }) {
  if (status === "denied") return <span className="sync-pill sync-bad">No access</span>;
  if (status === "disconnected")
    return (
      <span className="sync-pill sync-bad" role="status">
        <CloudOff size={13} aria-hidden /> Offline, edits kept here
      </span>
    );
  if (!synced)
    return (
      <span className="sync-pill" role="status">
        <Loader2 size={13} className="spin" aria-hidden /> Connecting
      </span>
    );
  return (
    <span className="sync-pill" role="status" aria-live="polite">
      {unsynced > 0 ? "Saving…" : "Saved"}
    </span>
  );
}

/** Agents working on this page now, from the live runs. */
function useWritersHere(pageId: string): { agent: Agent; run: Run }[] {
  const { data: graph } = useMap();
  const { data: agents } = useAgents();
  return useMemo(() => {
    const all = graph?.agents ?? agents ?? [];
    return (graph?.runs ?? [])
      .filter((r) => r.pageId === pageId && (r.status === "running" || r.status === "queued"))
      .flatMap((run) => {
        const agent = all.find((a) => a.id === run.agentId);
        return agent ? [{ agent, run }] : [];
      });
  }, [graph, agents, pageId]);
}

function Children({ page, pages }: { page: Page; pages: Page[] }) {
  const create = useCreatePage();
  const kids = childrenOf(pages, page.id);
  return (
    <section className="children" aria-labelledby="children-title">
      <h2 id="children-title" className="children-title">
        {kids.length ? "Inside this page" : "No pages inside yet"}
      </h2>
      <ul>
        {kids.map((k) => (
          <li key={k.id}>
            <Link to={`/p/${k.id}`} className="child-link">
              <span aria-hidden className="child-icon">{k.icon ?? <FileText size={15} />}</span>
              <span className="child-title">{pageTitle(k)}</span>
              {k.excerpt && <span className="child-excerpt">{k.excerpt}</span>}
            </Link>
          </li>
        ))}
        <li>
          <button type="button" className="child-link child-new" onClick={() => create.mutate({ parentId: page.id })} disabled={create.isPending}>
            <FilePlus2 size={15} aria-hidden /> Add a page inside
          </button>
        </li>
      </ul>
    </section>
  );
}

function PageBody({ page, pages }: { page: Page; pages: Page[] }) {
  const { data: me } = useMe();
  const { collab, status, synced, unsynced } = useCollab(page.id);
  const editorRef = useRef<TiptapEditor | null>(null);
  const writers = useWritersHere(page.id);
  const navigate = useNavigate();
  const del = useDeletePage();
  const onReady = useCallback((e: TiptapEditor) => (editorRef.current = e), []);
  const user = useMemo(
    () => ({ name: me?.person.name ?? "You", color: personColor(me?.person.id ?? "me") }),
    [me?.person.name, me?.person.id],
  );

  const updatedBy = page.updatedBy;
  const agentColor = (id: string) => writers.find((w) => w.agent.id === id)?.agent.color;

  return (
    <article className="page" aria-labelledby="page-title-label">
      <div className="page-toolbar">
        <SyncPill status={status} synced={synced} unsynced={unsynced} />
        <div className="page-actions">
          <button type="button" className="ghost-button" onClick={() => openDiaryWith("", null)} title="Ask an agent about this page">
            <Feather size={15} aria-hidden /> <span>Ask</span>
          </button>
          <Link to={`/?focus=${page.id}`} className="ghost-button" title="See this page on the map">
            <MapIcon size={15} aria-hidden /> <span>On the map</span>
          </Link>
          <button
            type="button"
            className="ghost-button danger"
            title="Delete this page"
            aria-label="Delete this page"
            disabled={del.isPending}
            onClick={() => {
              if (!confirm(`Tear out “${pageTitle(page)}”? Pages inside it go too.`)) return;
              del.mutate(page.id, { onSuccess: () => navigate(page.parentId ? `/p/${page.parentId}` : "/") });
            }}
          >
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      </div>

      <header className="page-head">
        {page.coverUrl && <img className="page-cover" src={page.coverUrl} alt="" />}
        {page.icon && <div className="page-icon" aria-hidden>{page.icon}</div>}
        <span id="page-title-label" className="sr-only">{pageTitle(page)}</span>
        <TitleField page={page} onEnter={() => editorRef.current?.commands.focus("start")} />
        <p className="page-meta">
          {updatedBy.kind === "agent" ? (
            <>
              Last written by <span className="hand-name" style={{ color: agentColor(updatedBy.id) }}>{updatedBy.name}</span>
            </>
          ) : (
            <>Edited by {updatedBy.id === me?.person.id ? "you" : updatedBy.name}</>
          )}{" "}
          · <time dateTime={page.updatedAt}>{timeAgo(page.updatedAt)}</time>
        </p>
        {writers.length > 0 && (
          <ul className="writers" aria-label="Agents on this page">
            {writers.map(({ agent }) => (
              <li key={agent.id} className="writer" style={{ ["--agent" as string]: agent.color }}>
                <span className="writer-nib" aria-hidden />
                <span className="hand-name">{agent.name}</span> is writing here
              </li>
            ))}
          </ul>
        )}
      </header>

      {status === "denied" ? (
        <p className="inline-error" role="alert">This page is in a notebook you can't open.</p>
      ) : collab ? (
        <PageEditor
          pageId={page.id}
          collab={collab}
          synced={synced}
          user={user}
          writerColor={writers[0]?.agent.color ?? null}
          onReady={onReady}
        />
      ) : null}

      <Children page={page} pages={pages} />
    </article>
  );
}

export function PageView() {
  const { id = "" } = useParams();
  const { data: page, error, isLoading, refetch } = usePage(id);
  const { data: pages = [] } = usePages();
  const listed = pages.find((p) => p.id === id);
  const current = page ? { ...page, ...(listed ?? {}) } : listed;

  useEffect(() => {
    document.title = current ? `${pageTitle(current)} · Inkwell` : "Inkwell";
  }, [current?.title]);

  if (current && !error) {
    return (
      <div className="page-scroll">
        <PageBody key={id} page={current} pages={pages} />
      </div>
    );
  }
  if (isLoading) {
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
  return (
    <div className="page-scroll">
      <div className="page page-missing" role="alert">
        {isNotFound(error) ? (
          <>
            <h1>This page has been torn out</h1>
            <p className="muted">It may have been deleted, or the link is from another notebook.</p>
          </>
        ) : (
          <>
            <h1>Couldn't open this page</h1>
            <p className="muted">{(error as Error | null)?.message ?? "Something went wrong."}</p>
            <button className="ghost-button" onClick={() => refetch()}>Try again</button>
          </>
        )}
        <Link to="/" className="ghost-button">
          <MapIcon size={15} aria-hidden /> Back to the map
        </Link>
      </div>
    </div>
  );
}
