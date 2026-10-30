export type Shortcut = "palette" | "diary" | "close-diary" | null;

/**
 * Which app-wide shortcut a key press means. Nothing fires while the welcome
 * is showing: it covers the app, and the palette or diary would open
 * underneath it, out of sight.
 */
export function shortcutFor(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  ctx: { welcome: boolean; diaryOpen: boolean; paletteOpen: boolean; inDiary: boolean },
): Shortcut {
  if (ctx.welcome) return null;
  const mod = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
  const key = e.key.toLowerCase();
  if (mod && key === "k") return "palette";
  if (mod && key === "j") return "diary";
  if (e.key === "Escape" && ctx.diaryOpen && !ctx.paletteOpen && ctx.inDiary) return "close-diary";
  return null;
}
