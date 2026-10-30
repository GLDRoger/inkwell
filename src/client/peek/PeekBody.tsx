import { Map as MapIcon } from "lucide-react";
import type { Id, Page } from "@shared/types";
import { isNotFound } from "../lib/api";
import { usePage, usePages } from "../lib/queries";
import { useCollab } from "../page/collab";
import { isDeletePending } from "../page/deleteUndo";
import { Authorship, PageDocument, SyncPill, Writers, useWritersHere } from "../page/PageDocument";

/**
 * A page's live body inside the peek panel: the same editor as the full page,
 * over the same Yjs document, so an agent's ink arrives here as it writes.
 * Loaded with the editor stack only once a page is peeked.
 */
export default function PeekBody({ pageId, readOnly, onSwap }: { pageId: Id; readOnly: boolean; onSwap(id: Id): void }) {
  const { data: page, error, isLoading } = usePage(pageId);
  const { data: pages = [] } = usePages();
  const listed = pages.find((p) => p.id === pageId);
  const current = page ? { ...page, ...(listed ?? {}) } : listed;
  const gone = isDeletePending(pageId);
  if (current && !error && !gone) return <Live key={pageId} page={current} pages={pages} readOnly={readOnly} onSwap={onSwap} />;
  if (isLoading && !gone)
    return (
      <div className="peek-doc page-skeleton" aria-busy="true" aria-label="Loading page">
        <div className="sk sk-line" />
        <div className="sk sk-line" />
        <div className="sk sk-line short" />
      </div>
    );
  return (
    <div className="peek-doc peek-missing" role="alert">
      <p>{gone || error == null || isNotFound(error) ? "This page isn't in this notebook any more." : "Couldn't open this page."}</p>
      <p className="muted">
        <MapIcon size={14} aria-hidden /> Pick another page on the map.
      </p>
    </div>
  );
}

function Live({ page, pages, readOnly, onSwap }: { page: Page; pages: Page[]; readOnly: boolean; onSwap(id: Id): void }) {
  const { collab, ...sync } = useCollab(page.id);
  const writers = useWritersHere(page.id);
  return (
    <div className="peek-doc">
      {page.coverUrl && <img className="peek-cover" src={page.coverUrl} alt="" />}
      <div className="peek-meta">
        <Authorship page={page} pages={pages} />
        <SyncPill {...sync} readOnly={readOnly} />
      </div>
      <Writers writers={writers} />
      <PageDocument page={page} collab={collab} sync={sync} writers={writers} readOnly={readOnly} onPageLink={onSwap} />
    </div>
  );
}
