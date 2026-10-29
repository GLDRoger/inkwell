import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useConnectionStatus } from "../lib/events";

/** A quiet notice when the live stream drops; waits a beat so brief blips don't flash. */
export function ConnectionNotice() {
  const status = useConnectionStatus();
  const [show, setShow] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    if (status === "open" && online) return setShow(false);
    const t = setTimeout(() => setShow(true), status === "connecting" ? 4000 : 1500);
    return () => clearTimeout(t);
  }, [status, online]);

  if (!show) return null;
  return (
    <div className="connection-notice" role="status">
      <WifiOff size={15} aria-hidden />
      {!online
        ? "You're offline. Changes will sync when you reconnect."
        : status === "reconnecting"
          ? "Lost the live connection. Reconnecting…"
          : "Connecting to the notebook…"}
    </div>
  );
}
