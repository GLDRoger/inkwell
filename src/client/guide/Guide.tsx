import { useCallback, useState } from "react";
import { openKeyDialog, setUi, useUi } from "../lib/ui";
import { useMetaKey } from "../lib/key";
import { useMe } from "../lib/queries";
import { CoachMark } from "./CoachMark";
import { markGuided } from "./seen";

export interface GuideStep {
  id: "map" | "diary" | "media" | "key";
  title: string;
  body: string;
  /** What the step points at. Missing targets (a phone layout, the map still loading) leave the mark on its own. */
  target: string | null;
}

/** The four steps (docs/DEMO-MODE.md), from the visitor's side. */
export const GUIDE_STEPS: GuideStep[] = [
  {
    id: "map",
    title: "Your notebook is a map",
    body: "Each card is a page. Click one to peek inside, double-click to open it, and drag to look around.",
    target: null,
  },
  {
    id: "diary",
    title: "Ask in the diary",
    body: "Write what you need. Scout researches, Wren writes and Atlas organises, and you can watch them walk to the pages they change.",
    target: ".quill-button",
  },
  {
    id: "media",
    title: "Photos and voice",
    body: "Photo to cards turns a picture of sticky notes or a whiteboard into pages. In the diary, the microphone lets you say a request instead of typing it.",
    target: '[aria-label^="Photo to cards"]',
  },
  {
    id: "key",
    title: "Add your Meta API key",
    body: "The agents, voice and photo reading run on Meta's models, using your own key. It stays in this browser. You can add it now, or later from this menu.",
    target: ".brand",
  },
];

/** The key step, when a key already works here. */
const CONNECTED_BODY = "The agents, voice and photo reading are ready to use. You can change the key or the model from this menu.";

/**
 * The guide to the visitor's own notebook: four skippable coach marks. Shown
 * once after "Try it yourself", and again from the brand menu.
 */
export function Guide() {
  const open = useUi((s) => s.guideOpen ?? false);
  if (!open) return null;
  return <GuideSteps />;
}

function GuideSteps() {
  const [at, setAt] = useState(0);
  const { key } = useMetaKey();
  const { data: me } = useMe();
  const step = GUIDE_STEPS[at];
  const last = at === GUIDE_STEPS.length - 1;
  const connected = !!key || !!me?.metaConnected;

  const close = useCallback(() => {
    markGuided();
    setUi({ guideOpen: false });
  }, []);
  const target = useCallback(() => (step.target ? document.querySelector(step.target) : null), [step.target]);

  const primary =
    step.id === "key" && !connected
      ? {
          label: "Add your key",
          run: () => {
            close();
            openKeyDialog();
          },
        }
      : { label: last ? "Done" : "Next", run: () => (last ? close() : setAt(at + 1)) };
  const secondary = at > 0 ? { label: "Back", run: () => setAt(at - 1) } : undefined;
  const laterInstead = step.id === "key" && !connected ? { label: "Later", run: close } : secondary;

  return (
    <CoachMark
      target={target}
      title={step.title}
      progress={{ at: at + 1, of: GUIDE_STEPS.length }}
      primary={primary}
      secondary={laterInstead}
      onClose={close}
    >
      <p>{step.id === "key" && connected ? CONNECTED_BODY : step.body}</p>
    </CoachMark>
  );
}
