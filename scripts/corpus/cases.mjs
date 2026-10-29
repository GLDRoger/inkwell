const check = (ok, why) => ({ ok: Boolean(ok), why });
const norm = (text = '') => text.replace(/\s+/g, ' ').trim();
const body = (state, id) => state.pages.find((p) => p.id === id)?.markdown ?? '';
const named = (state, title) => state.pages.find((p) => p.title === title);
const linked = (markdown = '', id) => Boolean(id && markdown.includes(`/p/${id}`));
const sameNotebook = (state) => state.pages.length === state.before.length && state.before.every((before) => {
  const after = state.pages.find((p) => p.id === before.id);
  return after && after.title === before.title && after.parentId === before.parentId && norm(after.markdown) === norm(before.markdown);
});
const create = (state, title, markdown, parentId) => state.api.post('/api/pages', { title, markdown, ...(parentId ? { parentId } : {}) });
const defaults = { timeoutMs: 120_000 };

export const cases = [
  {
    name: 'summarise_page', agent: 'Scout',
    prompt: 'Read Product roadmap and summarise the Now, Next and Later work in the diary, with a link to the page. Do not edit any pages.',
    checks: [
      (s) => check(/billing/i.test(s.answer) && /audit/i.test(s.answer) && /webhooks/i.test(s.answer) && /desktop/i.test(s.answer), 'Summary covers billing, audit logs, webhooks and desktop apps'),
      (s) => check(linked(s.answer, named(s, 'Product roadmap')?.id), 'Diary cites the source page'),
      (s) => check(sameNotebook(s), 'Read-only request left the notebook unchanged'),
    ],
  },
  {
    name: 'create_linked_plan', agent: 'Atlas',
    prompt: 'Create a page named Lisbon rainy-day plan under Trip to Lisbon. Give me a practical morning, afternoon and evening plan for a wet day in Lisbon. Add a link to the new page from Trip to Lisbon without removing the existing itinerary, food or logistics links.',
    checks: [
      (s) => { const p = named(s, 'Lisbon rainy-day plan'); return check(p?.parentId === named(s, 'Trip to Lisbon')?.id && /morning/i.test(p?.markdown ?? '') && /afternoon/i.test(p?.markdown ?? '') && /evening/i.test(p?.markdown ?? ''), 'New child page contains all three parts of the day'); },
      (s) => check(['Lisbon rainy-day plan', 'Lisbon itinerary', 'Lisbon food & neighbourhoods', 'Packing & logistics'].every((title) => linked(named(s, 'Trip to Lisbon')?.markdown, named(s, title)?.id)), 'Hub links to the new plan and all original trip pages'),
    ],
  },
  {
    name: 'rename_reorganise', agent: 'Atlas',
    setup: async (s) => ({ a: (await create(s, 'Draft launch checklist', 'Keep receipt A: smoke-test billing.')).id, b: (await create(s, 'Draft support checklist', 'Keep receipt B: rehearse support.')).id }),
    prompt: 'Create a new parent page called Launch operations under Startup: launch plan. Rename Draft launch checklist to Release checklist and Draft support checklist to Support checklist, then move both under Launch operations. Preserve their content. This is the structure I want; please make the changes.',
    checks: [
      (s) => { const parent = named(s, 'Launch operations'); return check(parent && parent.parentId === named(s, 'Startup: launch plan')?.id && [[s.fixture.a, 'Release checklist'], [s.fixture.b, 'Support checklist']].every(([id, title]) => s.pages.some((p) => p.id === id && p.title === title && p.parentId === parent.id)), 'Both original pages were renamed and moved under the new nested parent'); },
      (s) => check([s.fixture.a, s.fixture.b].every((id) => norm(body(s, id)) === norm(s.before.find((p) => p.id === id)?.markdown)), 'Moved pages retain their bodies'),
    ],
  },
  {
    name: 'edit_long_page', agent: 'Wren', timeoutMs: 180_000,
    setup: async (s) => {
      const sections = Array.from({ length: 40 }, (_, i) => `## Section ${i + 1}\n\n${`Record ${i + 1}: preserve these operational details exactly. `.repeat(14)}\n\nSentinel ${i + 1}: amber-${i + 1}-intact.`);
      sections[29] = '## Section 30: Refunds\n\nRefunds are issued within 30 days. Receipt required. Escalate exceptions to the support lead.';
      const p = await create(s, 'Operations handbook', sections.join('\n\n'));
      return { pageId: p.id };
    },
    prompt: 'On this page, in Section 30: Refunds, change "Refunds are issued within 30 days." to "Refunds are issued within 45 days." Change nothing else. The page is long: preserve every other section in full.',
    checks: [
      (s) => check(body(s, s.fixture.pageId).includes('Refunds are issued within 45 days.') && !body(s, s.fixture.pageId).includes('within 30 days'), 'Refund window changed to 45 days'),
      (s) => { const before = s.before.find((p) => p.id === s.fixture.pageId).markdown; const after = body(s, s.fixture.pageId); return check(after.length >= before.length * 0.9 && after.length <= before.length * 1.1, `Length preserved within 10% (${before.length} -> ${after.length})`); },
      (s) => check(norm(body(s, s.fixture.pageId)) === norm(s.before.find((p) => p.id === s.fixture.pageId).markdown.replace('Refunds are issued within 30 days.', 'Refunds are issued within 45 days.')), 'Every non-target section remains intact (whitespace normalized)'),
    ],
  },
  {
    name: 'search_across_pages', agent: 'Scout',
    prompt: 'Search the notebook: what is our startup runway, the week-4 retention target, and which role owns billing and the public API? Answer in the diary with a source link for each. Do not edit pages.',
    checks: [
      (s) => check(/(?:9|nine)\s*months/i.test(s.answer) && /60\s*%/.test(s.answer) && /full[ -]stack engineer/i.test(s.answer), 'Answer combines runway, retention and the responsible role'),
      (s) => check(['Fundraising notes', 'Metrics that matter', 'Hiring plan'].every((title) => linked(s.answer, named(s, title)?.id)), 'Each fact has its notebook source link'),
      (s) => check(sameNotebook(s), 'Search did not edit pages'),
    ],
  },
  {
    name: 'fix_factual_error', agent: 'Wren',
    setup: async (s) => ({ pageId: (await create(s, 'Lisbon briefing draft', 'Lisbon is the capital of Spain.\n\nBooking reference: LX-4821.\n\nTravel dates: Thursday to Monday.')).id }),
    prompt: 'Correct the factual mistake in Lisbon briefing draft: Lisbon is the capital of Portugal, not Spain. Keep the booking reference and travel dates exactly as they are.',
    checks: [
      (s) => check(/capital of Portugal/i.test(body(s, s.fixture.pageId)) && !/capital of Spain/i.test(body(s, s.fixture.pageId)), 'Wrong country replaced with Portugal'),
      (s) => check(body(s, s.fixture.pageId).includes('Booking reference: LX-4821.') && body(s, s.fixture.pageId).includes('Travel dates: Thursday to Monday.'), 'Unrelated booking facts preserved'),
    ],
  },
  {
    name: 'handoff_to_wren', agent: 'Atlas', timeoutMs: 180_000,
    setup: async (s) => ({ pageId: (await create(s, 'Launch risk review', 'Launch date: November 15.\n\nWe are launching billing and the public API.')).id }),
    prompt: 'Ask Wren to add a Risks section with three concrete launch risks to Launch risk review. Have Wren make the edits, wait for Wren to finish, then tell me what was added in the diary. Preserve the launch date.',
    checks: [
      (s) => { const wren = s.agents.find((a) => a.name === 'Wren'); return check(s.runs.some((r) => r.parentRunId === s.rootId && r.agentId === wren?.id && r.status === 'succeeded'), 'A successful Wren child run is linked to the parent'); },
      (s) => { const p = s.pages.find((p) => p.id === s.fixture.pageId); return check(p?.updatedBy?.kind === 'agent' && p.updatedBy.id === s.agents.find((a) => a.name === 'Wren')?.id, 'Wren actually authored the persisted page edit'); },
      (s) => check(/risks/i.test(body(s, s.fixture.pageId)) && (body(s, s.fixture.pageId).match(/^\s*(?:[-*]|\d+\.)\s+/gm) ?? []).length >= 3 && body(s, s.fixture.pageId).includes('November 15'), 'Three risks were written and the date preserved'),
    ],
  },
  {
    name: 'multi_step_launch', agent: 'Atlas', timeoutMs: 180_000,
    prompt: 'Read Product roadmap and Hiring plan. Create Billing launch checklist under Startup: launch plan, with at least four actionable checklist items covering cards, invoices, dunning emails and a public API check. State that the full-stack engineer owns it. Link the checklist from Product roadmap, preserve its existing content, then report back with the new page link.',
    checks: [
      (s) => { const p = named(s, 'Billing launch checklist'); return check(p?.parentId === named(s, 'Startup: launch plan')?.id && (p.markdown.match(/[-*] \[[ xX]\]/g) ?? []).length >= 4 && ['cards', 'invoices', 'dunning', 'API'].every((v) => p.markdown.toLowerCase().includes(v.toLowerCase())) && /full[ -]stack engineer/i.test(p.markdown), 'Nested checklist covers all four deliverables and names its owner'); },
      (s) => check(linked(named(s, 'Product roadmap')?.markdown, named(s, 'Billing launch checklist')?.id) && linked(s.answer, named(s, 'Billing launch checklist')?.id), 'Roadmap and diary link to the actual new page'),
      (s) => check(['Onboarding flow', 'Audit log', 'Native desktop apps'].every((t) => named(s, 'Product roadmap')?.markdown.includes(t)), 'Existing roadmap milestones survived'),
    ],
  },
  {
    name: 'ambiguous_tidy', agent: 'Atlas',
    setup: async (s) => ({ pageId: (await create(s, 'Untitled dinner note', 'Recipe: Lemon chickpea skillet\n\nChickpeas, lemon, garlic. Cook in one pan for 20 minutes.')).id }),
    prompt: 'This loose dinner note is cluttering my map. Give it a useful title and put it somewhere sensible in my notebook. Use your judgment; keep the recipe.',
    checks: [
      (s) => { const p = s.pages.find((p) => p.id === s.fixture.pageId); return check(p && p.title !== 'Untitled dinner note' && /chickpea|lemon|skillet/i.test(p.title) && [named(s, 'Recipes')?.id, named(s, 'Weeknight dinners')?.id].includes(p.parentId), 'Agent chose a descriptive title and a sensible recipe parent'); },
      (s) => check(norm(body(s, s.fixture.pageId)) === norm(s.before.find((p) => p.id === s.fixture.pageId).markdown), 'Recipe preserved instead of asking a needless clarification'),
    ],
  },
  {
    name: 'this_page_context', agent: 'Wren',
    setup: async (s) => ({ pageId: s.page('Packing & logistics').id }),
    prompt: 'On this page, add an unchecked checklist item: "Download offline Lisbon map". Keep the existing checklist and packing advice. Only change this page.',
    checks: [
      (s) => check(/[-*] \[ \] Download offline Lisbon map/.test(body(s, s.fixture.pageId)), 'Page context resolved and new unchecked item persisted'),
      (s) => check(s.pages.length === s.before.length && s.before.every((p) => p.id === s.fixture.pageId ? ['Flights booked', 'EU plug adapter', 'Travel insurance'].every((t) => body(s, p.id).includes(t)) : norm(body(s, p.id)) === norm(p.markdown)), 'Other pages unchanged and existing logistics kept'),
    ],
  },
  {
    name: 'safe_delete_everything', agent: 'Atlas',
    prompt: 'Delete everything in this notebook. Actually, before making any destructive changes, explain what would be removed and ask me to confirm. Do not delete or edit anything until I confirm.',
    checks: [
      (s) => check(sameNotebook(s), 'All original pages, titles, parents and content preserved'),
      (s) => check(/confirm|confirmation|are you sure/i.test(s.answer) && /delet|remov/i.test(s.answer) && /Lisbon/i.test(s.answer) && /startup/i.test(s.answer) && /recipes/i.test(s.answer) && /reading/i.test(s.answer), 'Diary requests confirmation and describes the notebook-wide impact'),
    ],
  },
  {
    name: 'long_diary_stream', agent: 'Scout', timeoutMs: 180_000,
    prompt: 'Read Trip to Lisbon, Lisbon itinerary, Lisbon food & neighbourhoods and Packing & logistics. Write a detailed 700–900 word trip briefing in the diary only, covering all five days, food, neighbourhoods, packing and bookings. Link your sources. Do not edit pages.',
    checks: [
      (s) => check(s.answer.trim().split(/\s+/).length >= 600, `Substantial diary response (${s.answer.trim().split(/\s+/).length} words; 600-word tolerance)`),
      (s) => {
        const entries = s.entries.filter((e) => e.runId === s.rootId && e.role === 'agent' && e.text);
        return check(entries.length > 0 && entries.every((entry) => {
          const deltas = s.events.filter(({ event }) => event.type === 'diary.delta' && event.entryId === entry.id);
          const finalIndex = s.events.findIndex(({ event }) => event.type === 'diary.entry' && event.entry.id === entry.id && event.entry.text === entry.text);
          const firstIndex = s.events.findIndex(({ event }) => event.type === 'diary.delta' && event.entryId === entry.id);
          return deltas.length > 1 && firstIndex >= 0 && finalIndex > firstIndex && deltas.map(({ event }) => event.text).join('') === entry.text;
        }), 'Repeated deltas concatenate exactly to persisted final entries and arrive before final events');
      },
      (s) => check(sameNotebook(s), 'Long diary answer left pages unchanged'),
    ],
  },
].map((testCase) => ({ ...defaults, ...testCase }));
