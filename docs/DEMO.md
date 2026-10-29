# Inkwell: 2:30 demo script

## Recording rules

Use a real notebook run, not the map development fixture. Record each operation to completion, then edit to the timeline below. Label any skipped wait as “Wait shortened”; these timings are editorial, not latency claims. Keep the diary reply and page changes from the same run. A model may call tools before it replies, so do not imply that reply-first ordering is guaranteed.

**Verification gate:** the current source wires photo import to the diary and cover generation to the page toolbar. TODO: check that the recording build contains those controls and rehearse both paths against live Meta models, including a successful SAM response. If the deployed build lacks a control, use the API preview below and label it as such. If a request fails, fix/retest it or disclose the missing demonstration; never replace it with a staged success.

## Pre-recording checklist

- [ ] Use a fresh browser profile or private window for a new anonymous workspace. Keep its cookie throughout the take. Use only demo content.
- [ ] Set `META_API_KEY` privately on the recording server. Verify agents, transcription, SAM + vision and image generation with real requests. Never show the key or environment file.
- [ ] If using the deployed server, follow [the environment update procedure](../deploy/README.md); restarting alone does not reload Compose environment values.
- [ ] Capture at 1920 × 1080, browser zoom 100%, with notifications off. Check that diary text and map names remain readable in the exported video.
- [ ] Turn reduced motion off for this recording so the ink and footsteps are visible. This is a recording choice, not a product requirement.
- [ ] Grant microphone permission. Check recording volume and WAV transcription before the take.
- [ ] Prepare a clear photo of three handwritten sticky notes: “Workshop: Saturday”, “Bring notebooks”, “Ask about access needs”. No personal data.
- [ ] Rehearse the prompts below. Check the final page text, the child run and the map events, not just the agent's claim of success.
- [ ] Verify the photo-to-cards and Paint a cover controls, including their loading and error states. Check that new cards and the cover actually render. Use the same-session API preview only as a clearly labelled fallback.
- [ ] Record a real walking-agent close-up for the opening. Capture it from the later work sequence, not an idle workspace or simulated event feed.
- [ ] Keep the final export at 2:30. Add captions and replace the video-link TODO in [SUBMISSION.md](SUBMISSION.md).

## Shot list

| Time | On screen and action | Voiceover |
| --- | --- | --- |
| 0:00–0:10 | Cold open on Scout's named footprints crossing the map during a real run. Brief title: “Inkwell · A notebook that writes back.” | “What if your notebook wrote back, and you could see where its agents were working? This is Inkwell.” |
| 0:10–0:23 | Zoom from the full seeded map into Product roadmap. Show the page excerpt, then open the full editor. | “Tom Riddle's diary meets the Marauder's Map. These are editable pages, not chat attachments. The map shows the notebook, and footprints show the agents moving through it.” |
| 0:23–0:39 | Open the diary and select Scout. Type: “Read Product roadmap and Hiring plan. Add a short Launch dependencies section to Product roadmap using only those pages. Keep everything else.” Send; hold on the sinking ink. | “I ask Scout to connect our roadmap and hiring notes. My words sink into the page. Scout can read and change the notebook, rather than give me text to copy elsewhere.” |
| 0:39–0:52 | Show the actual streamed reply writing itself and its linked tool steps. Use the completed reply if it arrives after the edits; mark the cut “Reply from this run”. | “The answer writes itself in Scout's ink. Beneath it, the steps link to the pages it visited. I can inspect what happened.” |
| 0:52–1:10 | Cut back to that run's footprints moving between pages. Then show Product roadmap open as the new section arrives through the live editor. Hold on preserved surrounding content. | “The footprints follow page operations. The edits go into the same live document I am looking at. Here is the new section, with the rest of the roadmap still intact.” |
| 1:10–1:30 | Send Scout: “Ask Wren to tighten only the Launch dependencies section on Product roadmap. Keep the facts and all other sections.” Show Wren on the map, its edit, then Scout's handoff step/result. | “Scout can hand a focused task to Wren, the writing agent. Wren edits the page and returns the result to Scout. This is a child run, not just a second name in the conversation.” |
| 1:30–1:44 | Click the diary microphone. Say: “Create a page called Workshop checklist with three preparation tasks.” Stop; show the transcript, review it and send. | “I can speak to the diary with Muse Voice Transcribe. The words return as an editable draft. I review them before sending.” |
| 1:44–2:03 | Show the sticky-note photo. In the diary, click “Turn a photo of notes into map cards” and choose it. Show the reading status, then the resulting parent and note cards on the map. Open one to check its text. Caption: “SAM 3.1 + Muse Spark vision”. | “For a photo, SAM supplies note regions and Spark reads the image. The importer turns the notes into editable cards, using detected positions to place them on the map.” |
| 2:03–2:17 | Open Workshop checklist and click “Paint a cover”. Show the painting state, then the generated PNG. Return to the map to show the card's cover at medium zoom. Caption: “Muse Image”. | “Muse Image paints a cover from the page's title and excerpt. It becomes a landmark on the map, so this page is easier to recognise when I zoom out.” |
| 2:17–2:30 | Pull out to the notebook. Hold on the revised pages, imported cards and cover. End card: live URL and repository. | “Inkwell is for students, researchers and small teams whose notes need to become work. Write, speak or bring a photo. Keep the result in your notebook, with the agent's path in view.” |

## API preview fallback

Only use this if the recording build lacks the controls. Label the photo and cover shots “API preview”, show the requests, and do not imply a button was used.

Use the browser's existing session on the demo origin. Upload the photo through the diary attachment control, but do not send it as a normal diary request. Read the returned attachment ID from the upload response. A diary attachment alone does **not** invoke the SAM import pipeline.

In that tab's DevTools console, replace the placeholder with that attachment ID:

```js
const imported = await fetch('/api/import/photo', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ attachmentId: 'REPLACE_WITH_UPLOADED_ATTACHMENT_ID' }),
});
if (!imported.ok) throw new Error(await imported.text());
console.log(await imported.json());
```

Return to the map and fit or pan to the imported cards. For the cover, open Workshop checklist and copy its page ID from `/p/:id`, then run:

```js
const painted = await fetch('/api/pages/REPLACE_WITH_PAGE_ID/illustrate', {
  method: 'POST',
});
if (!painted.ok) throw new Error(await painted.text());
console.log(await painted.json());
```

No API key belongs in these snippets. The server calls Meta. SAM can fail silently into a vision-only fallback, so cards appearing are not proof that SAM contributed. Confirm the segmentation response in a private rehearsal before using the SAM voiceover; otherwise caption and describe the run as vision-only. Do not promise pixel-perfect photo layout: map collision handling can move cards apart.
