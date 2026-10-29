import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Loader2, PenLine, X } from "lucide-react";
import type { Attachment, DiaryEntry, DiaryThread, Run } from "@shared/types";
import { ApiError, api, isNotFound } from "../lib/api";
import { keys, pageTitle, useAgents, useMap, usePages, useRun, useThread, useThreads } from "../lib/queries";
import { useServerEvent } from "../lib/events";
import { setUi, useUi } from "../lib/ui";
import { timeAgo } from "../lib/time";
import { diaryReducer, initialDiaryState, isBusy } from "./state";
import { Composer, type ComposerHandle } from "./Composer";
import { Entries, InkDrops, isActiveRun } from "./Entries";
import { Picker } from "./Picker";

const NEW = "__new__";

function EmptyPage({ onPick, onPage }: { onPick(text: string): void; onPage: boolean }) {
  const prompts = onPage
    ? ["Tidy up this page and fill the gaps", "What does this page link to?", "Turn this into a checklist"]
    : ["What's in this notebook?", "Draft a plan for next week", "Find pages that need work"];
  return (
    <div className="diary-empty">
      <p className="invitation">Write to me.</p>
      <ul className="prompts" aria-label="Things to ask">
        {prompts.map((p) => (
          <li key={p}>
            <button type="button" onClick={() => onPick(p)}>
              {p}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The ink gathering on the page after you send, until the agent's reply begins. */
function Gathering({ color }: { color: string }) {
  return (
    <p className="gathering" role="status">
      <InkDrops color={color} />
      <span className="sr-only">The diary is answering</span>
    </p>
  );
}

export function DiaryPanel() {
  const open = useUi((s) => s.diaryOpen);
  const draft = useUi((s) => s.diaryDraft);
  const client = useQueryClient();
  const [state, dispatch] = useReducer(diaryReducer, initialDiaryState);
  const [note, setNote] = useState<string | null>(null);
  const [contextDismissed, setContextDismissed] = useState<string | null>(null);
  const chosen = useRef(false);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);

  const threads = useThreads();
  const thread = useThread(state.threadId);
  const { data: agentList } = useAgents();
  const { data: graph } = useMap();
  const agents = agentList ?? graph?.agents ?? [];
  const { data: pages } = usePages();
  const pageMatch = useMatch("/p/:id");
  const pageId = pageMatch?.params.id ?? null;
  const contextPage = pageId && contextDismissed !== pageId ? pages?.find((p) => p.id === pageId) : undefined;

  // Open on the most recent thread the first time threads arrive.
  useEffect(() => {
    if (chosen.current || !threads.data) return;
    chosen.current = true;
    if (threads.data[0]) dispatch({ type: "selectThread", threadId: threads.data[0].id });
  }, [threads.data]);

  // Focus the page when the diary opens; give focus back when it closes.
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      const t = setTimeout(() => composer.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    if (panel.current?.contains(document.activeElement)) (opener.current as HTMLElement | null)?.focus?.();
  }, [open]);

  // "Ask an agent" from the palette.
  useEffect(() => {
    if (!draft) return;
    if (draft.agentId !== null) dispatch({ type: "selectAgent", agentId: draft.agentId });
    composer.current?.setText(draft.text);
  }, [draft?.nonce]);

  useServerEvent("diary.delta", (e) => dispatch({ type: "replyStarted", entryId: e.entryId, threadId: e.threadId }));
  useServerEvent("diary.entry", (e) => {
    if (e.entry.role === "agent") dispatch({ type: "replyStarted", entryId: e.entry.id, threadId: e.entry.threadId });
  });
  useServerEvent("run.updated", (e) => dispatch({ type: "runUpdated", run: e.run }));

  const entries = thread.data ?? [];
  const lastRunId = useMemo(() => [...entries].reverse().find((e) => e.runId)?.runId ?? null, [entries]);
  const watchedRunId = state.runId ?? lastRunId;
  const { data: watchedRun } = useRun(watchedRunId);
  const busy = isBusy(state) || isActiveRun(watchedRun);

  // Waiting for the reply to begin: we've sent, and the agent's entry (which gathers its own ink) isn't here yet.
  const lastPerson = [...entries].reverse().find((e) => e.role === "person");
  const answered = lastPerson ? entries.some((e) => e.role === "agent" && e.createdAt >= lastPerson.createdAt) : false;
  const gathering = (state.phase === "sending" && !state.sinking) || (state.phase === "waiting" && !answered);
  const replyAgent = agents.find((a) => a.id === (watchedRun?.agentId ?? state.agentId));

  // Keep the newest ink in view while it's being written, unless the reader scrolled up.
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => pinned.current && (el.scrollTop = el.scrollHeight));
    const content = el.firstElementChild;
    if (content) ro.observe(content);
    return () => ro.disconnect();
  }, [state.threadId]);

  const send = async (text: string, attachments: Attachment[]) => {
    dispatch({ type: "send", text });
    setNote(null);
    pinned.current = true;
    try {
      const res = await api.writeDiary({
        threadId: state.threadId ?? undefined,
        text,
        agentId: state.agentId ?? undefined,
        attachmentIds: attachments.length ? attachments.map((a) => a.id) : undefined,
        pageId: contextPage?.id,
      });
      client.setQueryData<DiaryEntry[]>(keys.thread(res.threadId), (old) =>
        old?.some((e) => e.id === res.entry.id) ? old : [...(old ?? []), res.entry],
      );
      if (!client.getQueryData<DiaryThread[]>(keys.threads)?.some((t) => t.id === res.threadId)) {
        void client.invalidateQueries({ queryKey: keys.threads, exact: true });
      }
      dispatch({ type: "sent", threadId: res.threadId, runId: res.runId, entryId: res.entry.id });
      // A run can finish (say, with no API key) before this response lands; its run.updated already went by.
      const run = client.getQueryData<Run | null>(keys.run(res.runId));
      if (run) dispatch({ type: "runUpdated", run });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1;
      dispatch({
        type: "sendFailed",
        text,
        error:
          status === 404
            ? { kind: "unavailable", message: "The diary can't write back yet: this server isn't running the agents. Your words are back on the page." }
            : status === 0
              ? { kind: "offline", message: "Couldn't reach the notebook. Your words are back on the page; try again when you're online." }
              : { kind: "failed", message: `${(e as Error).message || "Something went wrong"}. Your words are back on the page.` },
      });
    }
  };

  const cancel = async (runId: string | null) => {
    if (!runId) return;
    try {
      const run = await api.cancelRun(runId);
      client.setQueryData(keys.run(run.id), run);
      dispatch({ type: "cancelled" });
    } catch (e) {
      setNote(isNotFound(e) ? "This agent can't be stopped from here yet." : "Couldn't stop the agent. Try again.");
    }
  };

  const onSinkDone = useCallback(() => dispatch({ type: "sinkDone" }), []);
  const onDraftRestored = useCallback(() => dispatch({ type: "draftRestored" }), []);
  const threadList = threads.data ?? [];
  const currentThread = threadList.find((t) => t.id === state.threadId);

  return (
    <aside
      ref={panel}
      className="diary"
      aria-label="The diary"
      data-open={open}
      inert={!open}
      aria-hidden={!open}
    >
      <header className="diary-head">
        <Picker
          label="Diary pages"
          value={state.threadId ?? NEW}
          onChange={(v) => {
            chosen.current = true;
            dispatch({ type: "selectThread", threadId: v === NEW ? null : v });
            setNote(null);
          }}
          className="thread-picker"
          button={
            <>
              <BookOpen size={16} aria-hidden />
              <span className="thread-title">{currentThread?.title || (state.threadId ? "Diary" : "A fresh page")}</span>
            </>
          }
          options={[
            { value: NEW, label: "A fresh page", lead: <PenLine size={14} aria-hidden /> },
            ...threadList.map((t) => ({ value: t.id, label: t.title || "Untitled page", detail: timeAgo(t.updatedAt) })),
          ]}
        />
        <button
          type="button"
          className="icon-button"
          aria-label="Start a fresh page"
          title="Start a fresh page"
          onClick={() => {
            chosen.current = true;
            dispatch({ type: "selectThread", threadId: null });
            composer.current?.focus();
          }}
        >
          <PenLine size={17} aria-hidden />
        </button>
        <button type="button" className="icon-button" aria-label="Close the diary" onClick={() => setUi({ diaryOpen: false })}>
          <X size={18} aria-hidden />
        </button>
      </header>

      <div
        className="diary-paper"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        <div className="diary-content">
          {state.threadId && thread.isLoading && (
            <p className="muted diary-loading">
              <Loader2 size={15} className="spin" aria-hidden /> Turning to the page…
            </p>
          )}
          {state.threadId && !!thread.error && !isNotFound(thread.error) && (
            <p className="inline-error" role="alert">
              Couldn't open this diary page.{" "}
              <button className="link-button" onClick={() => thread.refetch()}>
                Try again
              </button>
            </p>
          )}
          {!entries.length && !thread.isLoading && !state.sinking && !gathering && (
            <EmptyPage onPage={!!contextPage} onPick={(t) => composer.current?.setText(t)} />
          )}
          <Entries entries={entries} agents={agents} liveIds={state.liveEntryIds} hiddenId={state.hiddenEntryId} onCancel={cancel} />
          {gathering && <Gathering color={replyAgent?.color ?? "var(--wax)"} />}
          {state.error && (
            <div className="diary-note" role="alert" data-kind={state.error.kind}>
              <p>{state.error.message}</p>
              <button type="button" className="link-button" onClick={() => dispatch({ type: "dismissError" })}>
                Dismiss
              </button>
            </div>
          )}
          {note && (
            <div className="diary-note" role="status">
              <p>{note}</p>
              <button type="button" className="link-button" onClick={() => setNote(null)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>

      <Composer
        ref={composer}
        agents={agents}
        agentId={state.agentId}
        onAgent={(id) => dispatch({ type: "selectAgent", agentId: id })}
        busy={busy}
        sending={state.phase === "sending"}
        sinking={state.sinking}
        onSinkDone={onSinkDone}
        onSend={send}
        onStop={() => cancel(watchedRun && isActiveRun(watchedRun) ? watchedRun.id : state.runId)}
        context={contextPage ? { id: contextPage.id, title: pageTitle(contextPage) } : null}
        onClearContext={() => setContextDismissed(pageId)}
        restoreDraft={state.restoreDraft}
        onDraftRestored={onDraftRestored}
        onNote={setNote}
      />
    </aside>
  );
}
