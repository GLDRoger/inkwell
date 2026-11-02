import type { Agent } from "../../shared/types.ts";
import { skillsFor } from "./load.ts";

export const skillMode = () => process.env.INKWELL_SKILLS === "inline" ? "inline" : "tool";
export function skillPrompt(agent: Agent) {
  const skills = skillsFor(agent);
  if (skillMode() === "inline") return skills.map(s => `Skill: ${s.name}\n${s.description}\n${s.body}`).join("\n\n");
  return "Skills: procedures you can load with load_skill before you start. Load one when the request matches its description.\n" +
    skills.map(s => `- ${s.name}: ${s.description}`).join("\n");
}
