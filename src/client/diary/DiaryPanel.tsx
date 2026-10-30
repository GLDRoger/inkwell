import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, MessageSquare, SquarePen, X } from "lucide-react";
import type { Agent, Attachment, DiaryEntry, DiaryThread, Run } from "@shared/types";
import { api, isNotFound } from "../lib/api";
import { keys, pageTitle, useAgents, useMap, usePages, useRun, useThread, useThreads } from "../lib/queries";
import { useServerEvent } from "../lib/events";
import { getUi, setUi, useUi } from "../lib/ui";
import { timeAgo } from "../lib/time";
import { diaryReducer, initialDiaryState, isBusy } from "./state";
import { Composer, type ComposerHandle } from "./Composer";
import { Entries, InkDrops, isActiveRun, type Recovery } from "./Entries";
import { Picker } from "./Picker";
import { COPY, STARTERS_NOTEBOOK, STARTERS_PAGE } from "./copy";
import { cancelErrorCopy, sendErrorCopy } from "./errors";
import { hasIntroduced, isWelcomeThread, markIntroduced, shouldIntroduce } from "./intro";

const NEW = "__new__";

/** One-tap requests: they send straight away. */
function Starters({ prompts, onPick, label = "Try asking" }: { prompts: string[]; onPick(text: string): void; label?: string }) {
  return (
    <div className="starters">
      <p className="starters-label">{label}</p>
      <ul aria-label={label}>
        {prompts.map((p) => (
          <li key={p}>
            <button type="button" className="starter" onClick={() => onPick(p)}>
              {p}
              <ArrowUpRight size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyConversation({ onPick, onPage, agents }: { onPick(text: string): void; onPage: boolean; agents: Agent[] }) {
  const names = new Set(agents.map((a) => a.name));
  const crew = names.has("Scout") && names.has("Wren") && names.has("Atlas");
  return (
    <div className="diary-empty">
      <h2 className="diary-headline">{onPage ? "What should we do with this page?" : "What should we work on?"}</h2>
      <p className="diary-lede">
        {crew ? "Scout researches, Wren writes and Atlas organises. " : ""}Ask for something and watch it happen across your pages.
      </p>
      <Starters prompts={onPage ? STARTERS_PAGE : STARTERS_NOTEBOOK} onPick={onPick} />
    </div>
  );
}

/** After you send, until the agent's reply begins. */
function Gathering({ agent }: { agent?: Agent }) {
  return (
    <p className="gathering" role="status">
      <InkDrops color={agent?.color ?? "var(--ink-faint)"} />
      <span className="gathering-label">
        {agent ? (
          <>
            <span className="agent-name" style={{ ["--agent" as string]: agent.color }}>{agent.name}</span> is on it…
          </>
        ) : (
          "Finding the right agent…"
        )}
      </span>
    </p>
  );
}

/** First run on a phone: a quiet pill instead of a full-screen sheet. */
function IntroNudge({ agent, onOpen, onDismiss }: { agent?: Agent; onOpen(): void; onDismiss(): void }) {
  return (
    <div className="intro-nudge" role="status">
      <button type="button" className="intro-nudge-open" onClick={onOpen}>
        <span className="agent-dot" style={{ background: agent?.color ?? "var(--ink-faint)" }} aria-hidden />
        <span>
          <strong>{agent?.name ?? "Atlas"}</strong> left you a note
        </span>
        <span className="intro-nudge-cta">Read it</span>
      </button>
      <button type="button" className="intro-nudge-close" aria-label="Dismiss" onClick={onDismiss}>
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}

const wide = () => typeof window !== "undefined" && window.matchMedia?.("(min-width: 641px)").matches;

/**
 * First run (see intro.ts): once the welcome has gone, open the diary beside
 * the map on wide screens, or offer a nudge on phones. Returns whether the
 * welcome note should write itself in, and the nudge state.
 */
function useIntro() {
  const [phase, setPhase] = useState<"idle" | "nudge" | "reveal" | "done">("idle");
  useEffect(() => {
    const app = document.querySelector(".app");
    const welcomed = !!app?.hasAttribute("data-welcome");
    const ok = shouldIntroduce({
      pathname: location.pathname,
      search: location.search,
      introduced: hasIntroduced(),
      automated: navigator.webdriver,
      welcomed,
    });
    if (!ok) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      // Let the map arrive first; the welcome's exit takes about this long to settle.
      timer = setTimeout(() => {
        markIntroduced();
        if (getUi().diaryOpen || wide()) {
          setPhase("reveal");
          setUi({ diaryOpen: true });
        } else setPhase("nudge");
      }, welcomed ? 650 : 900);
    };
    if (!app?.hasAttribute("data-welcome")) {
      start();
      return () => clearTimeout(timer);
    }
    const mo = new MutationObserver(() => {
      if (app.hasAttribute("data-welcome")) return;
      mo.disconnect();
      start();
    });
    mo.observe(app, { attributes: true, attributeFilter: ["data-welcome"] });
    return () => {
      mo.disconnect();
      clearTimeout(timer);
    };
  }, []);
  return {
    phase,
    reveal: () => {
      setPhase("reveal");
      setUi({ diaryOpen: true });
    },
    dismiss: () => setPhase("done"),
    finish: () => setPhase("done"),
  };
}

export function DiaryPanel() {
  const open = useUi((s) => s.diaryOpen);
  const draft = useUi((s) => s.diaryDraft);
  const client = useQueryClient();
  const [state, dispatch] = useReducer(diaryReducer, initialDiaryState);
  const [note, setNote] = useState<string | null>(null);
  const [contextDismissed, setContextDismissed] = useState<string | null>(null);
  const [settledIds, setSettledIds] = useState<string[]>([]);
  const chosen = useRef(false);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const wasOpen = useRef(open);
  /** Conversations started from a page during this visit, so reopening the diary there picks up where you were. */
  const pageThreads = useRef(new Map<string, string>());
  const intro = useIntro();

  const threads = useThreads();
  const thread = useThread(state.threadId);
  const { data: agentList } = useAgents();
  const { data: graph } = useMap();
  const agents = agentList ?? graph?.agents ?? [];
  const { data: pages } = usePages();
  const pageMatch = useMatch("/p/:id");
  const pageId = pageMatch?.params.id ?? null;
  const contextPage = pageId && contextDismissed !== pageId ? pages?.find((p) => p.id === pageId) : undefined;
  const threadList = threads.data ?? [];
  const currentThread = threadList.find((t) => t.id === state.threadId);

  // Open on the most recent conversation the first time they arrive (the welcome note, on a first run).
  // On a page, start fresh instead: the diary opens on a new conversation about that page.
  useEffect(() => {
    if (chosen.current || !threads.data) return;
    chosen.current = true;
    if (pageId && intro.phase === "idle") return;
    const first = intro.phase !== "idle" ? threads.data.find((t) => isWelcomeThread(t.title)) ?? threads.data[0] : threads.data[0];
    if (first) dispatch({ type: "selectThread", threadId: first.id });
  }, [threads.data, intro.phase]);

  // Opened on a page: a new conversation about this page (or the one already started from it), not the last one from elsewhere.
  useEffect(() => {
    if (!open || !pageId || busy || intro.phase !== "idle") return;
    const there = pageThreads.current.get(pageId) ?? null;
    chosen.current = true;
    if (state.threadId !== there) {
      dispatch({ type: "selectThread", threadId: there });
      setNote(null);
    }
  }, [open]);

  // Someone opened the diary themselves while the phone nudge was showing.
  useEffect(() => {
    if (open && intro.phase === "nudge") intro.reveal();
  }, [open, intro.phase]);

  // In time order: an agent's reply placeholder can reach the cache before the message it answers.
  const entries = useMemo(
    () =>
      [...(thread.data ?? [])].sort((a, b) =>
        a.createdAt === b.createdAt ? (a.role === b.role ? 0 : a.role === "person" ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
      ),
    [thread.data],
  );

  // First run: Atlas's welcome note writes itself in as the diary opens.
  useEffect(() => {
    if (intro.phase !== "reveal" || !threads.data) return;
    const welcome = threads.data.find((t) => isWelcomeThread(t.title));
    if (!welcome) return intro.finish();
    if (state.threadId !== welcome.id) {
      dispatch({ type: "selectThread", threadId: welcome.id });
      return;
    }
    if (!thread.data) return;
    const noteEntry = [...thread.data].reverse().find((e) => e.role === "agent");
    if (noteEntry && !thread.data.some((e) => e.role === "person")) dispatch({ type: "replyStarted", entryId: noteEntry.id, threadId: welcome.id });
    intro.finish();
  }, [intro.phase, threads.data, thread.data, state.threadId]);

  // Focus the composer when the diary opens; give focus back when it closes
  // (to whatever opened it, or the Diary button when it was opened from the keyboard).
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (open) {
      opener.current = document.activeElement;
      const t = setTimeout(() => composer.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    if (!was) return;
    const active = document.activeElement;
    if (active && active !== document.body && !panel.current?.contains(active)) return;
    const back = opener.current;
    const target =
      back instanceof HTMLElement && back !== document.body && back.isConnected && !panel.current?.contains(back)
        ? back
        : document.querySelector<HTMLElement>(".quill-button");
    target?.focus();
  }, [open]);

  // "Ask an agent" from the palette.
  useEffect(() => {
    if (!draft) return;
    if (draft.agentId !== null) dispatch({ type: "selectAgent", agentId: draft.agentId });
    // "Ask an agent" with nothing typed yet keeps whatever is already in the composer.
    if (draft.text) composer.current?.setText(draft.text);
  }, [draft?.nonce]);

  useServerEvent("diary.delta", (e) => dispatch({ type: "replyStarted", entryId: e.entryId, threadId: e.threadId }));
  useServerEvent("diary.entry", (e) => {
    if (e.entry.role === "agent") dispatch({ type: "replyStarted", entryId: e.entry.id, threadId: e.entry.threadId });
  });
  useServerEvent("run.updated", (e) => dispatch({ type: "runUpdated", run: e.run }));

  const lastRunId = useMemo(() => [...entries].reverse().find((e) => e.runId)?.runId ?? null, [entries]);
  const watchedRunId = state.runId ?? lastRunId;
  const { data: watchedRun } = useRun(watchedRunId);
  const busy = isBusy(state) || isActiveRun(watchedRun);

  // Waiting for the reply to begin: we've sent, and the agent's entry (which gathers its own ink) isn't here yet.
  const lastPerson = [...entries].reverse().find((e) => e.role === "person");
  const answered = lastPerson ? entries.some((e) => e.role === "agent" && e.createdAt >= lastPerson.createdAt) : false;
  const gathering = (state.phase === "sending" && !state.sinking) || (state.phase === "waiting" && !answered);
  const runAgentId = state.runId && watchedRun?.id === state.runId ? watchedRun.agentId : null;
  const replyAgent = agents.find((a) => a.id === (runAgentId ?? state.agentId));

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

  /** `again`: resending from a failed reply, so the words don't sink from the composer and go to the same agent. */
  const send = async (text: string, attachments: Attachment[], again?: { agentId: string }) => {
    dispatch({ type: "send", text, quiet: !!again });
    setNote(null);
    pinned.current = true;
    try {
      const res = await api.writeDiary({
        threadId: state.threadId ?? undefined,
        text,
        agentId: again?.agentId ?? state.agentId ?? undefined,
        attachmentIds: attachments.length ? attachments.map((a) => a.id) : undefined,
        pageId: contextPage?.id,
      });
      if (contextPage) pageThreads.current.set(contextPage.id, res.threadId);
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
      const error = sendErrorCopy(e, { kept: !again });
      if (error.reset === "page" && pageId) setContextDismissed(pageId);
      if (error.reset === "thread") void client.invalidateQueries({ queryKey: keys.threads, exact: true });
      dispatch({ type: "sendFailed", text: again ? "" : text, error });
    }
  };

  /** "Try again" resends the request the failed reply answered; "Continue" asks the same agent to carry on. */
  const recover = (entry: DiaryEntry, run: Run, how: Recovery) => {
    if (how === "continue") return send(COPY.continueRequest, [], { agentId: run.agentId });
    const at = entries.findIndex((e) => e.id === entry.id);
    const asked = entries.slice(0, at).reverse().find((e) => e.role === "person");
    void send(asked?.text || run.prompt, asked?.attachments ?? [], { agentId: run.agentId });
  };

  const cancel = async (runId: string | null) => {
    if (!runId) return;
    try {
      const run = await api.cancelRun(runId);
      client.setQueryData(keys.run(run.id), run);
      dispatch({ type: "cancelled" });
    } catch (e) {
      setNote(cancelErrorCopy(e));
    }
  };

  const onSinkDone = useCallback(() => dispatch({ type: "sinkDone" }), []);
  const onDraftRestored = useCallback(() => dispatch({ type: "draftRestored" }), []);
  const onSettled = useCallback((id: string) => setSettledIds((ids) => (ids.includes(id) ? ids : [...ids, id])), []);
  const newConversation = () => {
    chosen.current = true;
    dispatch({ type: "selectThread", threadId: null });
    setNote(null);
    composer.current?.focus();
  };

  // A conversation the person hasn't written in yet (the welcome note): offer the starters under it.
  const unanswered = entries.length > 0 && !entries.some((e) => e.role === "person");
  const lastAgent = [...entries].reverse().find((e) => e.role === "agent");
  const noteSettled = !lastAgent || !state.liveEntryIds.includes(lastAgent.id) || settledIds.includes(lastAgent.id);
  const showStarters = unanswered && !busy && !state.sinking && noteSettled;
  const nudgeAgent = agents.find((a) => a.name === "Atlas") ?? agents[0];

  return (
    <>
      {intro.phase === "nudge" && !open && (
        <IntroNudge agent={nudgeAgent} onOpen={intro.reveal} onDismiss={intro.dismiss} />
      )}
      <aside ref={panel} className="diary" aria-label="Diary" data-open={open} inert={!open} aria-hidden={!open}>
        <header className="diary-head">
          <Picker
            label={COPY.conversations}
            heading={COPY.conversations}
            value={state.threadId ?? NEW}
            onChange={(v) => {
              chosen.current = true;
              dispatch({ type: "selectThread", threadId: v === NEW ? null : v });
              setNote(null);
            }}
            className="thread-picker"
            button={<span className="thread-title">{currentThread?.title || (state.threadId ? COPY.untitledConversation : COPY.newConversation)}</span>}
            options={[
              { value: NEW, label: COPY.newConversation, lead: <SquarePen size={15} aria-hidden /> },
              ...threadList.map((t) => ({
                value: t.id,
                label: t.title || COPY.untitledConversation,
                detail: timeAgo(t.updatedAt),
                lead: <MessageSquare size={15} aria-hidden />,
              })),
            ]}
          />
          <button type="button" className="icon-button diary-icon" aria-label={COPY.newConversation} title={COPY.newConversation} onClick={newConversation}>
            <SquarePen size={17} aria-hidden />
          </button>
          <button type="button" className="icon-button diary-icon" aria-label="Close the diary" title="Close (Esc)" onClick={() => setUi({ diaryOpen: false })}>
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
                <Loader2 size={15} className="spin" aria-hidden /> Opening the conversation…
              </p>
            )}
            {state.threadId && !!thread.error && !isNotFound(thread.error) && (
              <p className="inline-error" role="alert">
                Couldn't open this conversation.{" "}
                <button className="link-button" onClick={() => thread.refetch()}>
                  Try again
                </button>
              </p>
            )}
            {state.threadId && isNotFound(thread.error) && (
              <p className="muted" role="status">
                This conversation was deleted.{" "}
                <button className="link-button" onClick={newConversation}>
                  {COPY.newConversation}
                </button>
              </p>
            )}
            {!entries.length && !thread.isLoading && !thread.error && !state.sinking && !gathering && (
              <EmptyConversation agents={agents} onPage={!!contextPage} onPick={(t) => send(t, [])} />
            )}
            <Entries
              entries={entries}
              agents={agents}
              liveIds={state.liveEntryIds}
              hiddenId={state.hiddenEntryId}
              recoverableId={!busy && !state.sinking && entries.at(-1)?.role === "agent" ? entries.at(-1)!.id : null}
              onCancel={cancel}
              onRecover={recover}
              onSettled={onSettled}
            />
            {showStarters && <Starters prompts={contextPage ? STARTERS_PAGE : STARTERS_NOTEBOOK} onPick={(t) => send(t, [])} />}
            {gathering && <Gathering agent={replyAgent} />}
            {state.error && (
              <div className="diary-note" role="alert" data-kind={state.error.kind}>
                <p>{state.error.message}</p>
                <button type="button" className="note-close" aria-label="Dismiss" onClick={() => dispatch({ type: "dismissError" })}>
                  <X size={14} aria-hidden />
                </button>
              </div>
            )}
            {note && (
              <div className="diary-note" role="status">
                <p>{note}</p>
                <button type="button" className="note-close" aria-label="Dismiss" onClick={() => setNote(null)}>
                  <X size={14} aria-hidden />
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
    </>
  );
}
