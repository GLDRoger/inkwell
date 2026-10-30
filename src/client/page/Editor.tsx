import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import {
  Code,
  FilePlus2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  Table,
  type LucideIcon,
} from "lucide-react";
import type { Page } from "@shared/types";
import { api } from "../lib/api";
import { keys, pageTitle, usePages } from "../lib/queries";
import { isDeletePending } from "./deleteUndo";
import { BrokenLinks, brokenLinksKey } from "./brokenLinks";
import { MenuStore } from "./suggestion";
import { SuggestionMenu } from "./SuggestionMenu";
import { SlashCommand, type SlashItem } from "./slash";
import { PageLinks, type PageLinkItem } from "./pageLinks";
import { InkDrying } from "./inkDrying";
import type { Collab } from "./collab";

const SLASH_ICONS: Record<string, LucideIcon> = { Pilcrow, Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, Quote, Code, Table, Minus };

export interface EditorUser {
  name: string;
  color: string;
}

interface Props {
  pageId: string;
  collab: Collab;
  synced: boolean;
  user: EditorUser;
  /** Colour of the agent writing here right now, for the wet ink. */
  writerColor: string | null;
  /** False shows the page without letting anyone type in it (the recorded demo). */
  editable?: boolean;
  onReady?(editor: TiptapEditor): void;
  /** Following a link to another page; navigates to it when not given. */
  onPageLink?(id: string): void;
}

/** A caret for someone else in the document; an agent's name is written in its hand while it edits. */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const color = typeof user.color === "string" ? user.color : "var(--ink-faint)";
  const caret = document.createElement("span");
  caret.className = "caret";
  if (user.kind === "agent") caret.classList.add("caret-agent");
  caret.style.setProperty("--caret", color);
  const label = document.createElement("span");
  label.className = "caret-label";
  label.textContent = typeof user.name === "string" ? user.name : "Someone";
  caret.append(label);
  return caret;
}

/**
 * The extension list. Mirrors what the server's schema can hold: StarterKit
 * (with links), task lists, tables and a placeholder.
 */
export function baseExtensions() {
  return [
    StarterKit.configure({
      undoRedo: false, // Yjs owns history
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: null } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
  ];
}

export function PageEditor({ pageId, collab, synced, user, writerColor, editable = true, onReady, onPageLink }: Props) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const slashStore = useMemo(() => new MenuStore<SlashItem>(), []);
  const linkStore = useMemo(() => new MenuStore<PageLinkItem>(), []);
  const syncedRef = useRef(false);
  const writerRef = useRef(writerColor);
  writerRef.current = writerColor;
  const linkRef = useRef(onPageLink);
  linkRef.current = onPageLink;
  const { data: pages } = usePages();
  const knownRef = useRef<ReadonlySet<string> | null>(null);
  const known = useMemo(() => (pages ? new Set(pages.filter((p) => !isDeletePending(p.id)).map((p) => p.id)) : null), [pages]);
  knownRef.current = known;

  // Let ink-drying start a beat after the first sync, so the initial load isn't painted wet.
  useEffect(() => {
    if (!synced) return;
    const t = setTimeout(() => (syncedRef.current = true), 400);
    return () => clearTimeout(t);
  }, [synced]);

  const editor = useEditor(
    {
      editable,
      extensions: [
        ...baseExtensions(),
        Placeholder.configure({
          placeholder: ({ node, editor }) =>
            node.type.name === "heading"
              ? "Heading"
              : editor.isEmpty
                ? "Write something, or press / for blocks and [[ to link a page…"
                : "Press / for blocks",
        }),
        Collaboration.configure({ document: collab.doc }),
        CollaborationCaret.configure({ provider: collab.provider, user: { ...user, kind: "person" }, render: renderCaret }),
        SlashCommand(slashStore),
        PageLinks({
          store: linkStore,
          currentPageId: pageId,
          getPages: () => client.getQueryData<Page[]>(keys.pages) ?? [],
          createPage: async (title) => {
            const page = await api.createPage({ parentId: pageId, title });
            client.setQueryData<Page[]>(keys.pages, (old) => (old ? [...old, page] : old));
            return page;
          },
        }),
        BrokenLinks.configure({ knownIds: () => knownRef.current }),
        InkDrying.configure({ isEnabled: () => syncedRef.current, getColor: () => writerRef.current }),
      ],
      editorProps: {
        attributes: { class: "prose", "aria-label": editable ? "Page body" : "Page body, read only", spellcheck: "true" },
        handleClickOn: () => false,
        handleDOMEvents: {
          click: (_view, event) => {
            const a = (event.target as HTMLElement).closest("a");
            if (!a) return false;
            const href = a.getAttribute("href") ?? "";
            if (href.startsWith("/p/") && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
              event.preventDefault();
              if (linkRef.current) linkRef.current(href.slice(3).split(/[?#]/)[0]);
              else navigate(href);
              return true;
            }
            if (/^https?:/.test(href) && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              window.open(href, "_blank", "noopener");
              return true;
            }
            return false;
          },
        },
      },
    },
    [collab],
  );

  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);

  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  // Page list changed (a page deleted or created): redraw broken links.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(brokenLinksKey, true).setMeta("addToHistory", false));
  }, [editor, known]);

  return (
    <div className="editor" data-synced={synced} data-readonly={!editable || undefined}>
      <EditorContent editor={editor} />
      <SuggestionMenu
        store={slashStore}
        id="slash-menu"
        label="Insert a block"
        keyOf={(i) => i.id}
        empty="No block matches"
        render={(item) => {
          const Icon = SLASH_ICONS[item.icon] ?? Pilcrow;
          return (
            <>
              <span className="suggest-icon" aria-hidden>
                <Icon size={16} />
              </span>
              <span className="suggest-text">
                <span className="suggest-title">{item.title}</span>
                <span className="suggest-hint">{item.hint}</span>
              </span>
            </>
          );
        }}
      />
      <SuggestionMenu
        store={linkStore}
        id="page-link-menu"
        label="Link to a page"
        keyOf={(i) => (i.kind === "page" ? i.page.id : `new:${i.title}`)}
        empty="Type to find a page"
        render={(item) =>
          item.kind === "page" ? (
            <>
              <span className="suggest-icon" aria-hidden>
                {item.page.icon ?? <FileText size={16} />}
              </span>
              <span className="suggest-text">
                <span className="suggest-title">{pageTitle(item.page)}</span>
              </span>
            </>
          ) : (
            <>
              <span className="suggest-icon" aria-hidden>
                <FilePlus2 size={16} />
              </span>
              <span className="suggest-text">
                <span className="suggest-title">New page “{item.title}”</span>
                <span className="suggest-hint">Create it inside this page and link it</span>
              </span>
            </>
          )
        }
      />
    </div>
  );
}
