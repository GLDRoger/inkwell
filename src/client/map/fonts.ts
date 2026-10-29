import { useEffect } from "react";

/**
 * The map's lettering: IM Fell English, a 17th-century face, for the names
 * of places, and Cedarville Cursive (the agents' hand) for who's walking.
 * Loaded by the map itself, once, so the rest of the app doesn't pay for it;
 * until it arrives (or offline) the map falls back to the app's serif.
 */
const HREF =
  "https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&family=Cedarville+Cursive&display=swap";

export function useMapFonts() {
  useEffect(() => {
    if (document.querySelector(`link[data-map-fonts]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = HREF;
    link.dataset.mapFonts = "";
    document.head.appendChild(link);
  }, []);
}
