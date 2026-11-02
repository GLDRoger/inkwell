import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent } from "../../shared/types.ts";

export interface Skill { name: string; description: string; body: string }
export interface AgentDefinition { name: string; description: string; color: string; instructions: string; seededText: string; skills: Skill[] }
const read = (file: string) => {
  const value = fs.readFileSync(file, "utf8").trim();
  if (!value) throw new Error(`Empty agent definition: ${file}`);
  return value;
};
export function loadDefinitions(root: string) {
  const primer = read(path.join(root, "primer.md"));
  const loadSkills = (directory: string): Skill[] => fs.readdirSync(directory).sort().filter(file => file.endsWith(".md")).map(file => {
    const name = path.basename(file, ".md");
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error(`Invalid skill name: ${file}`);
    const text = read(path.join(directory, file)).replace(/\r\n/g, "\n");
    const header = text.match(/^---\n([\s\S]*?)\n---\n?/);
    const description = header?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    const body = header ? text.slice(header[0].length).trim() : "";
    if (!description || !body) throw new Error(`Skill needs description frontmatter and body: ${file}`);
    return { name, description, body };
  });
  const shared = loadSkills(path.join(root, "_shared/skills"));
  const agents: Record<string, AgentDefinition> = {};
  for (const directory of ["scout", "wren", "atlas"]) {
    const dir = path.join(root, directory);
    const meta = JSON.parse(read(path.join(dir, "agent.json")));
    for (const key of ["name", "description", "color", "seededText"]) {
      if (typeof meta[key] !== "string" || !meta[key].trim()) throw new Error(`Missing ${key}: ${dir}/agent.json`);
    }
    if (meta.name.toLowerCase() !== directory || !/^#[a-f0-9]{6}$/i.test(meta.color)) throw new Error(`Invalid agent metadata: ${dir}`);
    const skills = [...shared, ...loadSkills(path.join(dir, "skills"))];
    if (new Set(skills.map(skill => skill.name)).size !== skills.length) throw new Error(`Duplicate skill name: ${dir}`);
    agents[meta.name] = { ...meta, instructions: read(path.join(dir, "instructions.md")), skills };
  }
  return { primer, agents, shared };
}

// Eager import validates all files before the server starts accepting requests.
export const AGENT_FILES = loadDefinitions(fileURLToPath(new URL("./defs/", import.meta.url)));
export const AGENT_DEFS = AGENT_FILES.agents;
function definitionFor(agent: Pick<Agent, "name" | "instructions">) {
  const def = AGENT_DEFS[agent.name];
  return def && (agent.instructions === def.seededText || agent.instructions === def.instructions) ? def : undefined;
}
export const instructionsFor = (agent: Pick<Agent, "name" | "instructions">) => definitionFor(agent)?.instructions ?? agent.instructions;
export const skillsFor = (agent: Pick<Agent, "name" | "instructions">): Skill[] => definitionFor(agent)?.skills ?? AGENT_FILES.shared;
