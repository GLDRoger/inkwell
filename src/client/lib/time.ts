import { useEffect, useState } from "react";

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday", then a date. A clock a little ahead of ours still reads "just now". */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.min(0, Math.round((t - now) / 1000));
  const a = Math.abs(s);
  if (a < 45) return "just now";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 7 * 86400) return rtf.format(Math.round(s / 86400), "day");
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The current time, re-read every `ms` so relative times ("5 minutes ago") keep moving. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
