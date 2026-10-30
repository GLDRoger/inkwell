/**
 * Every page an agent makes should carry an icon: on the map, a page without
 * one is a blank square at overview zoom. Use the model's choice when it's a
 * real emoji, else a guess from the title, else the parent's, else a page.
 */
const GUESSES: [RegExp, string][] = [
  [/\b(pack|packing|luggage|bag)\b/i, "🧳"],
  [/\b(trip|travel|flight|itinerary|lisbon|holiday|visit)\b/i, "✈️"],
  [/\b(checklist|to-?do|tasks?)\b/i, "✅"],
  [/\b(plan|roadmap|timeline|schedule|launch)\b/i, "🗺️"],
  [/\b(summary|summari[sz]ed?|recap|overview|digest|tl;?dr)\b/i, "📝"],
  [/\b(budget|cost|money|fundrais\w*|finance|pricing)\b/i, "💰"],
  [/\b(hiring|interview|team|candidate)\b/i, "🧑‍💼"],
  [/\b(metrics?|kpis?|numbers|stats|dashboard)\b/i, "📈"],
  [/\b(research|notes?|reading|book|ideas?)\b/i, "📚"],
  [/\b(recipe|dinner|cook|bake|bread|food|meal)\b/i, "🍳"],
  [/\b(meeting|agenda|minutes)\b/i, "🗓️"],
  [/\b(email|letter|message|draft)\b/i, "✉️"],
  [/\b(questions?|faq)\b/i, "❓"],
];

const EMOJI = /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u;

export function pickIcon(chosen: string | undefined, title: string, parentIcon?: string | null): string {
  const trimmed = chosen?.trim();
  if (trimmed && EMOJI.test(trimmed)) return trimmed;
  for (const [pattern, icon] of GUESSES) if (pattern.test(title)) return icon;
  return parentIcon || "📄";
}
