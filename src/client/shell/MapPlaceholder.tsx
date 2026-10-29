import { FilePlus2, Loader2 } from "lucide-react";
import { childrenOf, pageTitle, usePages } from "../lib/queries";
import { useCreatePage } from "../lib/mutations";

/** Shown at "/" until the map canvas ships: the notebook's top-level pages, so the app stays usable. */
export function MapPlaceholder({ onOpenPage }: { onOpenPage(id: string): void }) {
  const { data: pages, isLoading, error, refetch } = usePages();
  const create = useCreatePage();
  const top = pages ? childrenOf(pages, null) : [];

  return (
    <section className="map-placeholder" aria-labelledby="map-placeholder-title">
      <div className="map-placeholder-inner">
        <p className="eyebrow">The map is being drawn</p>
        <h1 id="map-placeholder-title">Your notebook</h1>
        {isLoading && (
          <p className="muted" aria-busy="true">
            <Loader2 className="spin" size={16} aria-hidden /> Unfolding the parchment…
          </p>
        )}
        {!!error && (
          <p className="inline-error" role="alert">
            Couldn't load your pages. <button className="link-button" onClick={() => refetch()}>Try again</button>
          </p>
        )}
        {pages && (
          <ul className="page-grid">
            {top.map((p) => (
              <li key={p.id}>
                <button type="button" className="page-card" onClick={() => onOpenPage(p.id)}>
                  <span className="page-card-title">{p.icon ? `${p.icon} ` : ""}{pageTitle(p)}</span>
                  {p.excerpt && <span className="page-card-excerpt">{p.excerpt}</span>}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="page-card page-card-new" onClick={() => create.mutate({})} disabled={create.isPending}>
                <FilePlus2 size={18} aria-hidden /> New page
              </button>
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}
