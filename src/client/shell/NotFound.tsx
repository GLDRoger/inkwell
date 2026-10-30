import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Map as MapIcon } from "lucide-react";

/** Any address the app doesn't know. */
export function NotFound() {
  useEffect(() => {
    document.title = "Nothing here · Inkwell";
  }, []);
  return (
    <div className="page-scroll">
      <div className="page missing" role="alert">
        <h1 className="missing-title">There's nothing at this address</h1>
        <p className="missing-body">The link may be mistyped or out of date. Your pages are all on the map.</p>
        <div className="missing-actions">
          <Link to="/" className="pill-button pill-primary">
            <MapIcon size={15} aria-hidden /> Back to the map
          </Link>
        </div>
      </div>
    </div>
  );
}
