import { useEffect, useState } from "react";
import { useMatch } from "react-router-dom";
import { WifiOff } from "lucide-react";
import { useConnectionStatus } from "../lib/events";
import { useBrowserOnline } from "../lib/ui";
import { offlineMessage } from "../page/syncState";

/**
 * A quiet notice when the notebook is out of reach; waits a beat so brief
 * blips don't flash. Its words come from the same place as the page's save
 * status, so the two always tell the same story.
 */
export function ConnectionNotice() {
  const status = useConnectionStatus();
  const online = useBrowserOnline();
  const onPage = useMatch("/p/:id") != null;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (status === "open" && online) return setShow(false);
    const t = setTimeout(() => setShow(true), !online ? 800 : status === "connecting" ? 4000 : 1500);
    return () => clearTimeout(t);
  }, [status, online]);

  if (!show) return null;
  const text =
    !online || status === "reconnecting" ? offlineMessage(online ? "unreachable" : "offline", onPage ? "page" : "map") : "Connecting to your notebook…";
  return (
    <div className="connection-notice" role="status">
      <WifiOff size={15} aria-hidden />
      {text}
    </div>
  );
}
