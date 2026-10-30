#!/usr/bin/env node
// Rehearsal stand-in for api.meta.ai. Node 22, no dependencies. Dev/rehearsal only.
//
//   node scripts/rehearsal/fake-meta.mjs [--port 8799] [--fast]
//   META_BASE_URL=http://127.0.0.1:8799/v1 META_API_KEY=rehearsal npm run dev:server
//
// Speaks the wire formats Inkwell sends and parses:
//   POST /v1/chat/completions   OpenAI-compatible, streaming SSE + tool calls (agents) and
//                               non-streaming JSON (photo-import vision call)
//   POST /v1/asr/transcribe     multipart {request JSON, audio WAV} -> { transcript, turns }
//   POST /v1/images/generations -> { data: [{ b64_json: <real PNG> }] }
//   POST /v1/responses          SAM 3.1: SSE with native <|box;...|> tokens
// The agent is a small keyword planner: it reads the latest user message and the tool
// results already in the conversation, then chooses the next real tool call.
import http from "node:http";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const NOTEBOOK_TOOLS = ["list_pages", "read_page", "search_pages", "create_page", "append_to_page",
  "edit_page", "rewrite_page", "rename_page", "move_page", "delete_page", "ask_agent"];
const FORBIDDEN = ["max_tokens", "stop", "n", "logprobs", "top_logprobs"];

// ---------------------------------------------------------------- small helpers

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
let counter = 0;
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}${(++counter).toString(36)}`;

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : part?.text ?? "").join("");
  return "";
}
function hasImage(content) {
  return Array.isArray(content) && content.some((part) => part?.type === "image_url" || part?.type === "input_image");
}
function tryJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function capitalise(text) { return text ? text[0].toUpperCase() + text.slice(1) : text; }
const link = (page) => `[${page.title}](/p/${page.id})`;
function list(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

// ---------------------------------------------------------------- markdown reading

/** Pull headings, bullets and prose out of a page so written content derives from what was read. */
function analyse(markdown = "") {
  const lines = markdown.split(/\r?\n/);
  const headings = [];
  const bullets = [];
  const paragraphs = [];
  const sections = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("|") || line.startsWith("```")) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      current = { heading: heading[1].trim(), bullets: [], prose: [] };
      sections.push(current);
      headings.push(current.heading);
      continue;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1].trim());
      current?.bullets.push(bullet[1].trim());
      continue;
    }
    const prose = line.replace(/^>\s*/, "");
    paragraphs.push(prose);
    current?.prose.push(prose);
  }
  const firstSentence = (paragraphs[0] ?? "").split(/(?<=[.!?])\s+/)[0] ?? "";
  return { headings, bullets, paragraphs, sections, firstSentence };
}
const plain = (text) => text.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
const shorten = (text, max = 140) => text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;

// ---------------------------------------------------------------- the conversation

const STOP = new Set(("a an and are as at be but by can could do does for from get give have help how i in into is it its " +
  "me my of on or our out please should so some than that the their them then there these this those to up us was " +
  "we what when where which who why will with would you your about all any just make new page pages notebook note notes " +
  "agent ask tell hand off over look find read write draft create plan summarise summarize summary overview recap tidy " +
  "organise organize rename move edit improve polish expand add update fix rewrite list want need know thing things " +
  "also each every everything delete remove wipe erase whole entire one two short quick").split(" "));

function readConversation(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
  const self = /You are (\w+)/.exec(system)?.[1] ?? "Scout";
  // Both system-prompt generations: "Available agents: A: ...; B: ..." and
  // "Other agents you can ask with ask_agent: A: ...; B: ...".
  const roster = /(?:Available agents|Other agents you can ask with ask_agent): ([^\n]*)/.exec(system)?.[1] ?? "";
  const agents = [...new Set([self, ...[...roster.matchAll(/(?:^|; )([^:;]+):/g)].map((m) => m[1].trim()).filter(Boolean)])];
  const lookingAt = /The person is looking at page (\S+?)\.?$/m.exec(system)?.[1] ??
    /(?:The person has .*? open|You start on .*?) \(id: ([^)\s]+)\)/.exec(system)?.[1] ?? null;
  let lastUser = -1;
  messages.forEach((m, i) => { if (m.role === "user") lastUser = i; });
  const user = lastUser >= 0 ? messages[lastUser] : { content: "" };
  const prompt = textOf(user.content).trim();
  // Tool calls and their results since the latest user message make up this run's progress.
  const steps = [];
  const byId = new Map();
  for (const m of messages.slice(lastUser + 1)) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const call of m.tool_calls) {
        const step = { name: call.function?.name, args: tryJson(call.function?.arguments ?? "{}") ?? {}, result: undefined, error: null };
        steps.push(step);
        byId.set(call.id, step);
      }
    }
    if (m.role === "tool") {
      const step = byId.get(m.tool_call_id);
      if (!step) continue;
      const raw = textOf(m.content);
      const value = typeof m.content === "string" || Array.isArray(m.content) ? raw : JSON.stringify(m.content);
      step.raw = value;
      step.error = value.startsWith("Error:") ? value.slice(6).trim() : null;
      step.result = step.error ? null : tryJson(value) ?? value;
    }
  }
  const tools = (Array.isArray(body.tools) ? body.tools : []).map((t) => t?.function?.name).filter(Boolean);
  const schemas = new Map((Array.isArray(body.tools) ? body.tools : []).map((t) => [t?.function?.name, t?.function?.parameters ?? {}]));
  return { messages, system, self, agents, lookingAt, prompt, steps, tools, schemas, image: hasImage(user.content) };
}

function intentOf(prompt, self, agents) {
  const p = prompt.toLowerCase();
  if (/\b(delete|remove|wipe|erase|destroy|clear)\b/.test(p) && /\b(every|all|whole|entire|everything)\b/.test(p)) return { kind: "refuse" };
  const other = agents.find((name) => name.toLowerCase() !== self.toLowerCase() && new RegExp(`\\b${name}\\b`, "i").test(prompt));
  if (other) return { kind: "handoff", agent: other };
  if (/\bsummar|\boverview\b|\brecap\b|\btl;?dr\b|\bdigest\b|\bkey points\b|\bgist\b/.test(p)) return { kind: "summarise" };
  if (/\brenam|\borgani[sz]|\btidy|\bmove\b|\brestructure|\bcross-?link|\blink (?:up|them|these|the|related)/.test(p)) return { kind: "organise" };
  if (/\b(add|append|expand|extend)\b.*\b(to|on|in)\b/.test(p) || /\b(improve|polish|edit|tighten|update|fix|rewrite)\b/.test(p)) return { kind: "edit" };
  if (/\b(plan|create|draft|write|outline|checklist|start|make|new)\b/.test(p)) return { kind: "create" };
  return { kind: "answer" };
}

function keywordsOf(prompt, agents) {
  const names = new Set(agents.map((a) => a.toLowerCase()));
  const words = prompt.replace(/\[[^\]]*\]\([^)]*\)/g, " ").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const seen = new Set();
  const out = [];
  for (let word of words) {
    word = word.replace(/['’]s$/, "");
    if (word.length < 3 || STOP.has(word) || names.has(word)) continue;
    if (word.length > 5 && word.endsWith("s") && !word.endsWith("ss")) word = word.slice(0, -1);
    if (!seen.has(word)) { seen.add(word); out.push(word); }
  }
  return out;
}

/** Explicit page references: /p/ID links or "page id: ID" (used by handoff requests). */
function explicitIds(prompt) {
  const ids = [...prompt.matchAll(/\/p\/([A-Za-z0-9_-]+)/g), ...prompt.matchAll(/page id:\s*([A-Za-z0-9_-]+)/gi)].map((m) => m[1]);
  return [...new Set(ids)];
}

/** The person's own words, without page links or handoff page ids. */
function ownWords(prompt) {
  return prompt.replace(/\(page id:[^)]*\)/gi, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "").replace(/Work on\s*\.?/g, "").trim();
}
function quotedTitle(prompt) {
  const words = ownWords(prompt);
  return /["“]([^"”]{2,80})["”]/.exec(words)?.[1]?.trim() ??
    /\b(?:called|named|titled|rename (?:it|this|the page) to)\s+([A-Z][^.!?\n]{1,60})$/.exec(words.replace(/[.!?]+$/, ""))?.[1]?.trim() ?? null;
}
function documentTitle(prompt, page) {
  const kind = /\b(?:a|an|the|my|our)\s+((?:[\p{L}-]+\s+){0,2}(?:plan|checklist|outline|agenda|brief|timeline|to-?do list))\b/iu.exec(ownWords(prompt))?.[1];
  if (quotedTitle(prompt)) return quotedTitle(prompt);
  if (!kind) return `Plan: ${page.title}`;
  // "Startup: launch plan" + "a launch plan" -> "Launch plan: next steps", not "Launch plan: Startup: launch plan".
  return page.title.toLowerCase().includes(kind.trim().toLowerCase()) ? `${capitalise(kind.trim())}: next steps` : `${capitalise(kind.trim())}: ${page.title}`;
}

// ---------------------------------------------------------------- the planner

const done = (steps, name) => steps.filter((s) => s.name === name);
const createdId = (step) => /\(id: ([^,)\s]+)/.exec(step?.raw ?? "")?.[1];

/** Fill optional protocol fields the tool schema asks for (e.g. a page version from the latest read or write). */
function withSchema(c, call) {
  const props = c.schemas.get(call.name)?.properties ?? {};
  if ("version" in props && call.args.pageId && call.args.version === undefined) {
    for (const step of [...c.steps].reverse()) {
      const target = step.args?.pageId ?? (step.name === "create_page" ? createdId(step) : undefined);
      if (target !== call.args.pageId || step.error) continue;
      const version = step.result?.version ?? /version: ([\w-]+)/.exec(step.raw ?? "")?.[1];
      if (version) { call.args.version = version; break; }
    }
  }
  return call;
}

function locate(c, { wantTree = false, reads = 1 } = {}) {
  const { steps, prompt, agents, lookingAt } = c;
  const listing = done(steps, "list_pages").find((s) => Array.isArray(s.result));
  const tree = listing?.result ?? null;
  if (wantTree && !listing) return { next: { name: "list_pages", args: {} } };
  const explicit = explicitIds(prompt);
  let candidates = [];
  if (explicit.length) {
    candidates = explicit.map((id) => tree?.find((p) => p.id === id) ?? { id, title: null });
  } else {
    const keywords = keywordsOf(prompt, agents);
    if (tree) {
      const scored = tree.map((p) => ({ p, score: keywords.filter((k) => p.title.toLowerCase().includes(k)).length }))
        .filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
      candidates = scored.map((x) => x.p);
    }
    if (!candidates.length) {
      const searches = done(steps, "search_pages");
      const hits = searches.flatMap((s) => Array.isArray(s.result) ? s.result : []);
      const inTitle = (p) => keywords.filter((k) => p.title.toLowerCase().includes(k)).length;
      const more = searches.length < Math.min(3, keywords.length);
      if (hits.length && (hits.some(inTitle) || !more)) {
        // Prefer pages whose title names the topic, then pages several searches agree on.
        const seen = (p) => hits.filter((h) => h.id === p.id).length;
        candidates = [...hits].sort((a, b) => inTitle(b) - inTitle(a) || seen(b) - seen(a));
      } else if (more) {
        return { next: { name: "search_pages", args: { query: keywords[searches.length] } } };
      } else if (!tree) {
        return { next: { name: "list_pages", args: {} } };
      } else {
        const fallback = tree.find((p) => p.id === lookingAt) ?? tree.find((p) => !p.parentId) ?? tree[0];
        candidates = fallback ? [fallback] : [];
      }
    }
    if (lookingAt) {
      const looking = candidates.find((p) => p.id === lookingAt);
      if (looking) candidates = [looking, ...candidates.filter((p) => p !== looking)];
    }
  }
  const unique = [...new Map(candidates.map((p) => [p.id, p])).values()].slice(0, reads);
  const read = done(steps, "read_page");
  for (const target of unique) {
    if (!read.some((s) => s.args.pageId === target.id)) return { next: { name: "read_page", args: { pageId: target.id } } };
  }
  const pages = read.filter((s) => s.result && typeof s.result === "object")
    .map((s) => ({ id: s.result.id, title: s.result.title, markdown: s.result.markdown ?? "" }));
  return { pages, tree, failed: read.filter((s) => s.error).map((s) => s.error) };
}

function summaryMarkdown(self, pages) {
  const sources = pages.map(link);
  const out = [`A short digest of ${list(sources)}, gathered by ${self}.`, ""];
  const first = analyse(pages[0].markdown);
  if (first.firstSentence) out.push("## In brief", "", plain(first.firstSentence), "");
  const points = pages.flatMap((p) => analyse(p.markdown).bullets.map((b) => shorten(b, 160))).slice(0, 7);
  if (points.length) out.push("## Key points", "", ...points.map((b) => `- ${b}`), "");
  const sections = pages.flatMap((p) => analyse(p.markdown).sections)
    .filter((s) => s.bullets.length || s.prose.length).slice(0, 5);
  if (sections.length) {
    out.push("## Section by section", "");
    for (const s of sections) out.push(`- **${plain(s.heading)}:** ${shorten(plain(s.prose[0] ?? s.bullets[0] ?? ""), 120)}`);
    out.push("");
  }
  out.push("## Sources", "", ...sources.map((s) => `- ${s}`));
  return out.join("\n");
}

function planMarkdown(self, pages, prompt) {
  const page = pages[0];
  const a = analyse(page.markdown);
  const all = pages.flatMap((p) => { const x = analyse(p.markdown); return x.bullets.length ? x.bullets : x.headings; });
  const tasks = all.slice(0, 7).map((b) => `- [ ] ${shorten(plain(b), 120)}`);
  const out = [`Working plan drafted by ${self} from ${list(pages.map(link))}.`, "", "## Goal", "",
    capitalise(plain(a.firstSentence || `Move ${page.title} forward.`)), ""];
  if (tasks.length) out.push("## Steps", "", ...tasks, "");
  const open = a.headings.slice(0, 3).map((h) => `- What still needs deciding under **${plain(h)}**?`);
  if (open.length) out.push("## Open questions", "", ...open, "");
  out.push("## Request", "", `> ${shorten(prompt.replace(/\s+/g, " "), 240)}`);
  return out.join("\n");
}

function appendMarkdown(self, page, prompt) {
  const a = analyse(page.markdown);
  const subject = /\badd (?:a |an |some )?(.+?)\s+(?:to|on|in|for)\b/i.exec(prompt)?.[1];
  const heading = subject ? capitalise(subject.trim()) : "Next steps";
  const items = (a.bullets.length ? a.bullets : a.headings).slice(0, 5).map((b) => `- [ ] ${shorten(plain(b), 110)}`);
  return [`## ${heading}`, "", ...(items.length ? items : ["- [ ] Decide the first step"]), "",
    `*Added by ${self}, based on what's already on this page.*`].join("\n");
}

function editFor(page, self) {
  const lines = page.markdown.split("\n");
  const markdown = page.markdown;
  // A small reviewable edit: add a one-line lede above the first paragraph.
  const candidate = lines.find((line) => line.trim().length > 30 && !/^\s*(#|[-*+]|\d+[.)]|\||>)/.test(line) &&
    markdown.indexOf(line) === markdown.lastIndexOf(line));
  if (!candidate) return null;
  const a = analyse(markdown);
  const gist = a.headings.length ? `Covers ${list(a.headings.slice(0, 3).map((h) => plain(h).toLowerCase()))}.` : shorten(plain(candidate), 100);
  return { find: candidate, replace: `**In short:** ${gist}\n\n${candidate}`, note: `added a one-line lede (“${gist}”)`, self };
}

function finalReply(text) { return { text }; }

function agentTurn(c) {
  const turn = planTurn(c);
  if (turn.call) withSchema(c, turn.call);
  return turn;
}

function planTurn(c) {
  const { steps, self, prompt, tools } = c;
  // Plain chats (e.g. smoke tests) without notebook tools.
  if (!tools.some((t) => NOTEBOOK_TOOLS.includes(t))) {
    if (tools.length && !steps.length) {
      return { call: { name: tools[0], args: { message: "hello" } } };
    }
    const exact = /reply with exactly:\s*(.+)$/i.exec(prompt)?.[1];
    return finalReply(exact ?? (steps.length ? "Done." : `Hello from the rehearsal Meta API. You said: ${shorten(prompt, 200)}`));
  }
  if (steps.length >= 12) return finalReply("I've taken as many steps as I should for one request. Here's where I got to — ask me to continue if you want more.");
  const intent = intentOf(prompt, self, c.agents);
  const opener = steps.length ? "" : {
    refuse: "", handoff: `Let me find the right page before I bring in ${intent.agent}.\n\n`,
    summarise: "Gathering the pages for this.\n\n", organise: "Taking a look at how the notebook is laid out.\n\n",
    edit: "Reading the page first.\n\n", create: "Looking through the notebook for material.\n\n", answer: "Searching the notebook.\n\n",
  }[intent.kind];
  const withOpener = (call) => ({ call, text: opener });

  if (intent.kind === "refuse") {
    const listing = done(steps, "list_pages")[0];
    if (!listing) return withOpener({ name: "list_pages", args: {} });
    const count = Array.isArray(listing.result) ? listing.result.length : "all";
    return finalReply(`I won't delete everything. Your notebook has ${count} pages, and wiping them all is the kind of thing I only do when you name the exact pages. ` +
      "If some pages are clutter, tell me which ones — or ask Atlas to tidy them under a parent instead, which is easy to undo.");
  }

  const found = locate(c, { wantTree: intent.kind === "organise", reads: intent.kind === "summarise" || intent.kind === "create" ? 2 : 1 });
  if (found.next) return withOpener(found.next);
  const { pages, tree } = found;
  if (!pages.length) {
    const why = found.failed?.[0] ? ` (${found.failed[0]})` : "";
    return finalReply(`I couldn't find a page about that in your notebook${why}. Tell me the page title, or open the page and ask again.`);
  }
  const page = pages[0];

  if (intent.kind === "answer") {
    const a = analyse(page.markdown);
    const points = a.bullets.slice(0, 3).map((b) => `- ${shorten(b, 140)}`);
    return finalReply([`From ${link(page)}: ${plain(a.firstSentence) || "it's mostly lists rather than prose."}`,
      ...(points.length ? ["", "The notes that stand out:", ...points] : []),
      "", "Want me to turn that into a plan or a summary page?"].join("\n"));
  }

  if (intent.kind === "summarise") {
    const created = done(steps, "create_page")[0];
    if (!created) return { call: { name: "create_page", args: {
      title: `Summary: ${page.title}`.slice(0, 120), parentId: page.id, markdown: summaryMarkdown(self, pages) } } };
    if (created.error) return finalReply(`I read ${list(pages.map(link))} but couldn't save the summary: ${created.error}`);
    const id = createdId(created);
    const a = analyse(page.markdown);
    return finalReply(`I read ${list(pages.map(link))} and wrote [${created.args.title}](/p/${id}) under ${page.title}. ` +
      `${a.bullets.length ? `It pulls out ${Math.min(7, pages.reduce((n, p) => n + analyse(p.markdown).bullets.length, 0))} key points` : "It condenses the main sections"}` +
      `${a.firstSentence ? `, starting from “${shorten(plain(a.firstSentence), 110).replace(/[.!?…]+$/, "")}”.` : "."}`);
  }

  if (intent.kind === "create") {
    const created = done(steps, "create_page")[0];
    const title = documentTitle(prompt, page);
    if (!created) return { call: { name: "create_page", args: { title: title.slice(0, 120), parentId: page.id, markdown: planMarkdown(self, pages, prompt) } } };
    if (created.error) return finalReply(`I couldn't create the plan page: ${created.error}`);
    const id = createdId(created);
    const tasks = (created.args.markdown.match(/^- \[ \]/gm) ?? []).length;
    return finalReply(`Drafted [${created.args.title}](/p/${id}) under ${link(page)}: a goal, ${tasks} steps drawn from ${list(pages.map((p) => p.title))}, and a few open questions. Tick items off as you go, or ask me to expand any step.`);
  }

  if (intent.kind === "edit") {
    const additive = /\b(add|append|expand|extend)\b/i.test(prompt);
    const edit = !additive ? editFor(page, self) : null;
    const name = edit ? "edit_page" : "append_to_page";
    const wrote = done(steps, name)[0];
    if (!wrote) return { call: edit ? { name, args: { pageId: page.id, find: edit.find, replace: edit.replace } }
      : { name, args: { pageId: page.id, markdown: appendMarkdown(self, page, prompt) } } };
    if (wrote.error) return finalReply(`I read ${link(page)} but the edit didn't go through: ${wrote.error}`);
    if (edit) return finalReply(`I made one small edit to ${link(page)}: ${edit.note}. Everything else is unchanged.`);
    const heading = /^## (.+)$/m.exec(wrote.args.markdown)?.[1] ?? "a new section";
    return finalReply(`Added a “${heading}” section to the end of ${link(page)}, built from the notes already on the page. Nothing above it changed.`);
  }

  if (intent.kind === "organise") {
    const p = prompt.toLowerCase();
    const title = quotedTitle(prompt);
    if (/renam/.test(p)) {
      const renamed = done(steps, "rename_page")[0];
      const next = title ?? `${page.title} (${new Date().getFullYear()})`;
      if (!renamed) return { call: { name: "rename_page", args: { pageId: page.id, title: next } } };
      if (renamed.error) return finalReply(`I couldn't rename ${link(page)}: ${renamed.error}`);
      return finalReply(`Renamed “${page.title}” to [${renamed.args.title}](/p/${page.id}). Links to it keep working.`);
    }
    const under = /\b(?:under|into|inside|beneath)\s+(.+)$/i.exec(prompt)?.[1]?.toLowerCase();
    const parent = under && tree?.find((t) => t.id !== page.id && under.includes(t.title.toLowerCase().split(/[:&—-]/)[0].trim()));
    if (parent) {
      const moved = done(steps, "move_page")[0];
      if (!moved) return { call: { name: "move_page", args: { pageId: page.id, parentId: parent.id } } };
      if (moved.error) return finalReply(`I couldn't move ${link(page)}: ${moved.error}`);
      return finalReply(`Filed ${link(page)} under ${link(parent)}.`);
    }
    const self_ = tree?.find((t) => t.id === page.id);
    const relatives = (tree ?? []).filter((t) => t.id !== page.id &&
      (t.parentId === page.id || t.id === self_?.parentId || (self_?.parentId && t.parentId === self_.parentId)))
      .filter((t) => !page.markdown.includes(`/p/${t.id}`)).slice(0, 6);
    const appends = done(steps, "append_to_page");
    const onPage = appends.find((s) => s.args.pageId === page.id);
    if (relatives.length && !onPage) return { call: { name: "append_to_page", args: { pageId: page.id, markdown:
      ["## Related pages", "", ...relatives.map((t) => `- ${link(t)}`), "", `*Linked by ${self}.*`].join("\n") } } };
    // Then walk to each child page and make sure it links back to its parent.
    const children = (tree ?? []).filter((t) => t.parentId === page.id).slice(0, 3);
    const reads = done(steps, "read_page");
    const backlinked = [];
    const already = [];
    for (const child of children) {
      const read = reads.find((s) => s.args.pageId === child.id);
      if (!read) return { call: { name: "read_page", args: { pageId: child.id } } };
      if (!read.result || read.result.markdown?.includes(`/p/${page.id}`)) { already.push(child); continue; }
      const wrote = appends.find((s) => s.args.pageId === child.id);
      if (!wrote) return { call: { name: "append_to_page", args: { pageId: child.id, markdown: `*Filed under ${link(page)}.*` } } };
      if (!wrote.error) backlinked.push(child);
    }
    const parts = [];
    if (onPage && !onPage.error) parts.push(`${link(page)} now links to ${list(relatives.map(link))}`);
    if (onPage?.error) parts.push(`I couldn't add links to ${link(page)} (${onPage.error})`);
    if (backlinked.length) parts.push(`${list(backlinked.map(link))} now link${backlinked.length === 1 ? "s" : ""} back to ${page.title}`);
    if (already.length) parts.push(`${list(already.map((t) => t.title))} already did`);
    if (!onPage && !backlinked.length) {
      return finalReply(`${link(page)} is already tidy: it links to everything near it on the map${already.length ? `, and ${list(already.map(link))} link back to it` : ""}. I left it as it is.`);
    }
    if (!parts.length) return finalReply(`${link(page)} is already tidy: it links to everything near it on the map, so I left it as it is.`);
    return finalReply(`Tidied around ${link(page)}: ${parts.join("; ")}. I didn't move or delete anything.`);
  }

  if (intent.kind === "handoff") {
    const asked = done(steps, "ask_agent")[0];
    const role = intent.agent.toLowerCase();
    const task = prompt.replace(new RegExp(`\\b(?:ask|have|get|tell|let)?\\s*${intent.agent}\\b\\s*(?:to)?`, "i"), "").replace(/^[\s,:;-]+/, "").replace(/[\s.!?]+$/, "").trim();
    const fallback = role === "wren" ? "Polish" : role === "atlas" ? "Tidy and link" : "Summarise";
    const request = `${capitalise(task.length > 8 ? task : `${fallback} this page`)}. Work on ${link(page)} (page id: ${page.id}).`;
    if (!asked) return { call: { name: "ask_agent", args: { agentName: intent.agent, request } } };
    if (asked.error) return finalReply(`I asked ${intent.agent} to help with ${link(page)}, but it didn't work out: ${asked.error}`);
    const answer = String(asked.result ?? "").replace(new RegExp(`^${intent.agent}:\\s*`), "");
    return finalReply(`I found ${link(page)} and handed it to ${intent.agent}. Their report:\n\n> ${answer.split("\n").join("\n> ")}`);
  }
  return finalReply("Done.");
}

// ---------------------------------------------------------------- photo import (vision)

const PHOTO_NOTES = [
  { title: "Launch checklist", markdown: "- Ship the map\n- Record the 2:30 demo\n- Write the submission" },
  { title: "Ask Wren", markdown: "Turn the Lisbon itinerary into a one-page handout." },
  { title: "Reading", markdown: "Finish *Thinking in Systems*, ch. 4 — stocks and flows." },
  { title: "Bread", markdown: "Feed the starter Friday night. Bake loaf 42 Saturday." },
  { title: "Open question", markdown: "Do agents need their own colours on the map, or names only?" },
];
const DEFAULT_BOXES = [[0.06, 0.08, 0.3, 0.38], [0.38, 0.06, 0.62, 0.34], [0.7, 0.1, 0.94, 0.4], [0.12, 0.52, 0.38, 0.86], [0.56, 0.54, 0.86, 0.9]];

function photoNotes(body) {
  const text = (body.messages ?? []).map((m) => textOf(m.content)).join("\n");
  const supplied = tryJson(/Segmentation boxes \(normalized 0\.\.1\): (\[.*\])/.exec(text)?.[1] ?? "[]");
  const boxes = Array.isArray(supplied) && supplied.length ? supplied : DEFAULT_BOXES;
  const notes = boxes.slice(0, PHOTO_NOTES.length).map((box, i) => ({ ...PHOTO_NOTES[i], box }));
  return JSON.stringify(notes);
}

// ---------------------------------------------------------------- SAM 3.1 segmentation

function imageFromInput(input) {
  for (const item of Array.isArray(input) ? input : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === "input_image" && typeof part.image_url === "string") {
        const match = /^data:[^;,]+;base64,(.*)$/s.exec(part.image_url);
        if (match) return Buffer.from(match[1], "base64");
      }
    }
  }
  return null;
}
function imageSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  if (bytes.readUInt32BE(0) === 0x89504e47) return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  if (bytes.toString("ascii", 0, 3) === "GIF") return { w: bytes.readUInt16LE(6), h: bytes.readUInt16LE(8) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      const size = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: bytes.readUInt16BE(i + 7), h: bytes.readUInt16BE(i + 5) };
      }
      i += 2 + size;
    }
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") return { w: 1 + bytes.readUIntLE(24, 3), h: 1 + bytes.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { w: bytes.readUInt16LE(26) & 0x3fff, h: bytes.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") {
      const b = bytes.readUInt32LE(21);
      return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) };
    }
  }
  return null;
}
function samTokens(size) {
  const { w, h } = size && size.w > 0 && size.h > 0 ? size : { w: 1000, h: 1000 };
  return DEFAULT_BOXES.map(([x1, y1, x2, y2], i) =>
    `${i}<|box;x1=${Math.round(x1 * w)};y1=${Math.round(y1 * h)};x2=${Math.round(x2 * w)};y2=${Math.round(y2 * h)};w=${w};h=${h};c=${(0.95 - i * 0.03).toFixed(2)}|>` +
    `<|mask;x=${Math.round(x1 * w)};y=${Math.round(y1 * h)};data=24,24,~...|>`).join(",");
}

// ---------------------------------------------------------------- Muse Image (procedural PNG)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function pngChunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type, "ascii"), data]);
  let crc = 0xffffffff;
  for (const byte of payload) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  payload.copy(out, 4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
/** A parchment vignette with ink contour "coastlines", seeded by the prompt. */
export function parchmentPng(seedText = "", width = 640, height = 400) {
  const seed = hash(seedText);
  const rand = (n) => ((Math.sin(seed * 0.0001 + n * 12.9898) * 43758.5453) % 1 + 1) % 1;
  const f = [1, 2, 3, 4].map((i) => ({ fx: 2 + rand(i) * 5, fy: 2 + rand(i + 9) * 5, px: rand(i + 20) * 6.28, py: rand(i + 30) * 6.28 }));
  const row = 1 + width * 3;
  const pixels = Buffer.alloc(height * row);
  for (let y = 0; y < height; y++) {
    pixels[y * row] = 0;
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      const grain = ((Math.sin((x * 12.9898 + y * 78.233) * (1 + (seed % 7))) * 43758.5453) % 1 + 1) % 1;
      const dx = u - 0.5, dy = v - 0.5;
      const vignette = 1 - Math.min(1, (dx * dx + dy * dy) * 1.6);
      let r = 233 * (0.78 + 0.22 * vignette) + grain * 10 - 5;
      let g = 218 * (0.76 + 0.24 * vignette) + grain * 9 - 4;
      let b = 178 * (0.7 + 0.3 * vignette) + grain * 8 - 4;
      // Height field -> contour lines in sepia ink.
      const field = f.reduce((s, k) => s + Math.sin(u * k.fx * 3.1416 + k.px) * Math.cos(v * k.fy * 3.1416 + k.py), 0);
      const contour = Math.abs(((field * 3) % 1 + 1) % 1 - 0.5);
      if (contour > 0.46) { const ink = (contour - 0.46) / 0.04; r -= 120 * ink; g -= 105 * ink; b -= 80 * ink; }
      if (field > 1.4) { r -= 18; g -= 10; b -= 22; } // "land" wash
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (edge === 10 || edge === 11 || edge === 16) { r = 92; g = 64; b = 40; } // double frame
      const at = y * row + 1 + x * 3;
      pixels[at] = Math.max(0, Math.min(255, r));
      pixels[at + 1] = Math.max(0, Math.min(255, g));
      pixels[at + 2] = Math.max(0, Math.min(255, b));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels, { level: 6 })), pngChunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- HTTP server

const TRANSCRIPT = "Ask Wren to draft a packing checklist for the Lisbon trip.";

export function startFakeMeta({ port = 8799, host = "127.0.0.1", fast = false, quiet = false } = {}) {
  const delay = (min, max) => fast ? Promise.resolve() : sleep(between(min, max));
  const log = (...args) => { if (!quiet) console.log("[fake-meta]", ...args); };

  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, message, type = "invalid_request_error") => send(res, status, { error: { message, type } });

  async function streamChat(req, res, model, turn) {
    const id = nextId("chatcmpl");
    const created = Math.floor(Date.now() / 1000);
    let closed = false;
    res.on("close", () => { closed = true; });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const write = (choice, extra = {}) => {
      if (!closed) res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, ...choice }], ...extra })}\n\n`);
    };
    // Thinking time before a tool step lets the map footprints visibly travel.
    await delay(turn.call ? 400 : 250, turn.call ? 900 : 500);
    write({ delta: { role: "assistant", content: "" }, finish_reason: null });
    let tokens = 0;
    for (const piece of (turn.text ?? "").match(/\S+\s*|\s+/g) ?? []) {
      if (closed) return;
      write({ delta: { content: piece }, finish_reason: null });
      tokens++;
      await delay(30, 60);
    }
    if (turn.call) {
      const args = JSON.stringify(turn.call.args);
      const third = Math.ceil(args.length / 3);
      write({ delta: { tool_calls: [{ index: 0, id: nextId("call"), type: "function", function: { name: turn.call.name, arguments: "" } }] }, finish_reason: null });
      for (let i = 0; i < args.length; i += third) {
        write({ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + third) } }] }, finish_reason: null });
        await delay(20, 40);
      }
    }
    const completion = tokens + (turn.call ? 20 : 0);
    write({ delta: {}, finish_reason: turn.call ? "tool_calls" : "stop" },
      { usage: { prompt_tokens: 900, completion_tokens: completion, total_tokens: 900 + completion } });
    if (!closed) res.end("data: [DONE]\n\n");
  }

  function jsonChat(res, model, turn, content) {
    const message = { role: "assistant", content: content ?? turn?.text ?? "" };
    if (turn?.call) message.tool_calls = [{ id: nextId("call"), type: "function", function: { name: turn.call.name, arguments: JSON.stringify(turn.call.args) } }];
    send(res, 200, { id: nextId("chatcmpl"), object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message, finish_reason: turn?.call ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 } });
  }

  async function handle(req, res, raw) {
    const url = new URL(req.url ?? "/", "http://fake");
    const route = url.pathname.replace(/^\/v1(?=\/)/, "");
    const auth = req.headers.authorization ?? "";
    const isMultipart = (req.headers["content-type"] ?? "").startsWith("multipart/form-data");
    const body = isMultipart ? null : tryJson(raw.toString("utf8"));
    const model = body?.model ?? (isMultipart ? tryJson(/name="request"[^\r\n]*\r\n(?:[^\r\n]+\r\n)*\r\n(\{[^\r\n]*\})/.exec(raw.toString("latin1"))?.[1] ?? "")?.model : undefined);

    if (req.method === "GET" && (route === "/health" || route === "/")) return send(res, 200, { ok: true, service: "inkwell rehearsal Meta API" });
    if (req.method !== "POST") return fail(res, 405, "Method not allowed");
    if (!/^Bearer \S+/.test(auth)) return fail(res, 401, "Missing or invalid API key", "authentication_error");

    if (route === "/chat/completions") {
      if (!body || !Array.isArray(body.messages)) return fail(res, 400, "messages is required");
      const bad = FORBIDDEN.find((key) => body[key] !== undefined);
      if (bad) return fail(res, 400, `Unsupported parameter: ${bad}`);
      if (body.tool_choice !== undefined && body.tool_choice !== "auto") return fail(res, 400, "tool_choice must be \"auto\"");
      const system = body.messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
      if (/Transcribe notes from the image/.test(system) && body.messages.some((m) => hasImage(m.content))) {
        log(`POST ${url.pathname} model=${model} vision photo-notes`);
        await delay(600, 1200);
        return jsonChat(res, model, null, photoNotes(body));
      }
      const c = readConversation(body);
      const turn = agentTurn(c);
      log(`POST ${url.pathname} model=${model} ${body.stream ? "stream" : "json"} agent=${c.self} step=${c.steps.length + 1} -> ${turn.call ? `tool ${turn.call.name}` : "reply"}`);
      if (body.stream) return streamChat(req, res, model, turn);
      return jsonChat(res, model, turn);
    }

    if (route === "/asr/transcribe") {
      log(`POST ${url.pathname} model=${model ?? "?"} bytes=${raw.length}`);
      const text = raw.toString("latin1");
      if (!isMultipart || !/name="request"/.test(text) || !/name="audio"/.test(text)) {
        return fail(res, 400, "Expected multipart parts \"request\" (JSON) and \"audio\" (WAV)");
      }
      if (!/RIFF[\s\S]{4}WAVE/.test(text)) return fail(res, 400, "audio must be WAV");
      await delay(500, 900);
      return send(res, 200, { transcript: TRANSCRIPT, turns: [{ transcript: TRANSCRIPT, start_ms: 0, end_ms: 3200 }] });
    }

    if (route === "/images/generations") {
      log(`POST ${url.pathname} model=${model} format=${body?.output_format ?? "?"}`);
      if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) return fail(res, 400, "prompt is required");
      await delay(900, 1600);
      return send(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: parchmentPng(body.prompt).toString("base64") }] });
    }

    if (route === "/responses") {
      log(`POST ${url.pathname} model=${model} ${body?.stream ? "stream" : "json"} segmentation`);
      if (!body || !Array.isArray(body.input)) return fail(res, 400, "input is required");
      const output = samTokens(imageSize(imageFromInput(body.input)));
      const response = { id: nextId("resp"), object: "response", status: "completed", model,
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: output }] }] };
      await delay(400, 800);
      if (!body.stream) return send(res, 200, { ...response, output_text: output });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const event = (data) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
      event({ type: "response.created", response: { ...response, status: "in_progress", output: [] } });
      for (const piece of output.match(/.{1,80}/gs) ?? []) {
        event({ type: "response.output_text.delta", item_id: "msg_0", output_index: 0, content_index: 0, delta: piece });
        await delay(10, 30);
      }
      event({ type: "response.output_text.done", item_id: "msg_0", output_index: 0, content_index: 0, text: output });
      event({ type: "response.completed", response });
      return res.end();
    }

    log(`${req.method} ${url.pathname} -> 404`);
    return fail(res, 404, `Unknown endpoint ${url.pathname}`);
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 48 * 1024 * 1024) { fail(res, 413, "Request too large"); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      handle(req, res, Buffer.concat(chunks)).catch((error) => {
        console.error("[fake-meta] handler failed", error);
        if (!res.headersSent) fail(res, 500, "Rehearsal API error", "server_error");
        else res.end();
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      log(`listening on http://${host}:${actual}/v1`);
      resolve({ port: actual, url: `http://${host}:${actual}/v1`,
        close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const fake = await startFakeMeta({
    port: Number(arg("--port") ?? process.env.REHEARSAL_META_PORT ?? 8799),
    fast: process.argv.includes("--fast") || process.env.REHEARSAL_FAST === "1",
  });
  const stop = () => fake.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
