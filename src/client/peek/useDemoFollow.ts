import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Id } from "@shared/types";
import type { CameraController, Insets } from "../map/camera";
import type { MapLayout } from "../map/layout";
import type { MapState } from "../map/model";
import { FOLLOW_PAUSE_MS, type FollowGate, followTarget, peekCamera } from "./follow";

/**
 * The demo camera. While the recorded demo plays, follow its focus: fly to the
 * agent or page at work, and peek the page once an agent writes there. Moving
 * the map, or picking or closing a page yourself, pauses following for
 * FOLLOW_PAUSE_MS (the map pauses `gate` for those).
 */
export function useDemoFollow(o: {
  following: boolean;
  focus: { pageId?: Id; agentId?: Id };
  camera: CameraController;
  gate: FollowGate;
  state: MapState | null;
  layout: MapLayout;
  writing: { has(id: Id): boolean };
  /** True once the map has placed its first view. */
  ready: MutableRefObject<boolean>;
  peekRef: MutableRefObject<Id | null>;
  setPeek(id: Id | null, by: "person" | "demo"): void;
  insets(): Insets;
  midScale(): number;
}) {
  const { following, focus, camera, gate, state, layout, writing, ready, peekRef, setPeek, insets, midScale } = o;
  const followingRef = useRef(following);
  followingRef.current = following;
  const [tick, setTick] = useState(0);
  const followed = useRef<{ page: Id | null; peek: Id | null }>({ page: null, peek: null });

  // A person moving the camera pauses following; when the pause ends, look again.
  useEffect(() => {
    let resume: ReturnType<typeof setTimeout> | undefined;
    camera.onUser = () => {
      if (!followingRef.current) return;
      gate.pause(Date.now());
      clearTimeout(resume);
      resume = setTimeout(() => {
        followed.current.page = null;
        setTick((n) => n + 1);
      }, FOLLOW_PAUSE_MS + 50);
    };
    return () => {
      camera.onUser = null;
      clearTimeout(resume);
    };
  }, [camera, gate]);
  useEffect(() => {
    // A new step: look again, even at the same page.
    followed.current.page = null;
  }, [focus]);
  useEffect(() => {
    if (following) return;
    followed.current = { page: null, peek: null };
    gate.reset();
  }, [following, gate]);

  useEffect(() => {
    if (!following || !state || !ready.current || !gate.active(Date.now())) return;
    const t = followTarget({
      focus,
      agentAt: (id) => state.walkers.get(`agent:${id}`),
      hasPage: (id) => layout.cards.has(id),
      writing,
    });
    if (t.peek && t.peek !== followed.current.peek && t.peek !== peekRef.current) {
      followed.current.peek = t.peek;
      setPeek(t.peek, "demo");
      // The peek's own camera takes it from here, once the panel is in place.
      if (t.pageId === t.peek) {
        followed.current.page = t.pageId;
        return;
      }
    }
    if (!t.pageId || t.pageId === followed.current.page) return;
    followed.current.page = t.pageId;
    const target = peekCamera(layout.cards.get(t.pageId)!, camera.cam, camera.vw, camera.vh, insets(), midScale());
    if (!target) return;
    // Calm and slow, and the minimap stays asleep: the viewer didn't move anything.
    camera.hush(1600);
    camera.flyTo(target, 1100);
  }, [following, state, layout, writing, focus, tick, camera, gate, ready, peekRef, insets, midScale, setPeek]);
}
