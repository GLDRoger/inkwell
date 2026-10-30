import type { Agent } from "../../shared/types.ts";

/**
 * "Any agent" in the diary: pick the seeded specialist whose job the request
 * describes. Cheap and predictable on purpose: no extra model call before the
 * reply starts.
 *
 * 1. An agent named in the request ("ask Wren to…") wins.
 * 2. An attached image goes to Wren: a photo is almost always "turn this into a page".
 * 3. Otherwise the main verb decides: the first sentence that opens with one, after
 *    polite openers ("can you", "please", "I'd like you to") are stripped. "Here is
 *    a photo. Turn it into a page" is decided by "Turn".
 * 4. Otherwise every agent is scored on its signals; ties go Wren, Atlas, Scout.
 * 5. A bare question with no signals is research (Scout).
 */
type Name = "Scout" | "Wren" | "Atlas";

const LEADING: Record<Name, RegExp> = {
  Wren: /^(write|draft|rewrite|edit|polish|proofread|reword|expand|shorten|tighten|improve|fix|add|insert|append|turn|make|create|start|compose|outline|plan|prepare|translate|continue|finish|update|put together)\b/i,
  Atlas: /^(organi[sz]e|reorgani[sz]e|tidy|clean up|rename|retitle|move|file|link|connect|group|sort|nest|merge|restructure|arrange)\b/i,
  Scout: /^(summari[sz]e|find|search|look up|look for|compare|research|recap|list|gather|tell me|show me|check|explain|review|what|which|who|when|where|why|how)\b/i,
};

const SIGNALS: Record<Name, RegExp[]> = {
  Wren: [/\b(write|draft|rewrite|polish|proofread|reword|expand|shorten|typos?|wording|tone|prose|paragraph|section|intro|email|letter|blog|post|essay|story|checklist|packing list|itinerary|outline)\b/i],
  Atlas: [/\b(organi[sz]e|reorgani[sz]e|tidy|rename|retitle|structure|messy|cluttered)\b/i, /\b(move|file|nest)\s+(it|this|that|these|them|the\s+\w+\s+page|pages?|under)\b/i, /\blink(s|ing)?\s+(between|related|these|them|the pages)\b/i],
  Scout: [/\b(summari[sz]e|summary|find|search|compare|research|recap|overview|tl;?dr|look up|what did i|where did i|which pages?)\b/i],
};

const TIE_ORDER: Name[] = ["Wren", "Atlas", "Scout"];
const POLITE = /^\s*(?:(?:hey|hi|ok(?:ay)?|so)[,\s]+)?(?:(?:can|could|would|will) you(?: please)?|please|pls|i(?:'d| would) like you to|i want you to|i need you to|help me(?: to)?|go ahead and|let's)\s+/i;

/** Sentences (and lines) of a request, in order. */
const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);

export function pickAgent(agents: Agent[], text: string, options: { image?: boolean } = {}): Agent | undefined {
  const byName = new Map(agents.map(agent => [agent.name.toLowerCase(), agent]));
  const get = (name: Name) => byName.get(name.toLowerCase());

  const named = text.match(/\b(?:ask|get|have|let|tell)\s+(\w+)/i)?.[1]?.toLowerCase();
  if (named && byName.has(named)) return byName.get(named);

  if (options.image && get("Wren")) return get("Wren");

  for (const sentence of sentences(text)) {
    const core = sentence.replace(POLITE, "").replace(POLITE, "").trim();
    for (const name of ["Atlas", "Wren", "Scout"] as Name[]) {
      if (LEADING[name].test(core) && get(name)) return get(name);
    }
  }

  let best: Name | undefined;
  let bestScore = 0;
  for (const name of TIE_ORDER) {
    const score = SIGNALS[name].filter(re => re.test(text)).length;
    if (score > bestScore && get(name)) { best = name; bestScore = score; }
  }
  if (best) return get(best);
  return get("Scout") ?? agents[0];
}
