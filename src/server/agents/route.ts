import type { Agent } from "../../shared/types.ts";

/**
 * "Any agent" in the diary: pick the seeded specialist whose job the request
 * describes. Cheap and predictable on purpose: no extra model call before the
 * reply starts. Falls back to the first agent when nothing matches.
 */
const SIGNALS: Record<string, RegExp> = {
  Atlas: /\b(organi[sz]e|tidy|tidies|file|move|rename|retitle|link|links|connect|group|sort|structure|reorgani[sz]e|clean ?up|merge|nest)\b/i,
  Wren: /\b(write|draft|rewrite|edit|polish|expand|shorten|improve|proofread|reword|tone|turn .* into|make .* (?:shorter|longer|clearer)|checklist|outline|plan (?:my|a|the)|itinerary|email|letter|post|story)\b/i,
  Scout: /\b(find|search|look up|summari[sz]e|summary|compare|what|which|who|when|where|why|how|list|gather|research|recap|tl;?dr|overview)\b/i,
};
const ORDER = ["Atlas", "Wren", "Scout"] as const;

export function pickAgent(agents: Agent[], text: string): Agent | undefined {
  const byName = new Map(agents.map(agent => [agent.name.toLowerCase(), agent]));
  // Named in the request ("ask Wren to…") wins.
  const named = text.match(/\b(?:ask|get|have|let)\s+(\w+)/i)?.[1]?.toLowerCase();
  if (named && byName.has(named)) return byName.get(named);
  // A question is research ("what did I write about…?"), unless it asks to reorganise.
  const question = /\?\s*$/.test(text) || /^\s*(what|which|who|when|where|why|how|did|do|does|is|are|have)\b/i.test(text);
  const order = question ? (["Atlas", "Scout"] as const) : ORDER;
  for (const name of order) {
    const agent = byName.get(name.toLowerCase());
    if (agent && SIGNALS[name]!.test(text)) return agent;
  }
  return agents[0];
}
