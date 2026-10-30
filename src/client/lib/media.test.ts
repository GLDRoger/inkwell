import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { handledAiRefusal, mediaErrorCopy, modelsConnected, readyForAi, resetModelsConnected } from "./media";
import { forgetKey, saveKey } from "./key";
import { getUi, setUi } from "./ui";
import { initialDemo, setDemo } from "./demo";
import { getNotices, dismiss } from "./notices";

beforeEach(() => {
  forgetKey();
  setDemo(initialDemo("own"));
  setUi({ keyDialog: null });
});
afterEach(() => {
  resetModelsConnected();
  getNotices().forEach((n) => dismiss(n.id));
});

describe("cover copy", () => {
  it("says make, not paint, and asks for a key when Meta isn't connected", () => {
    expect(mediaErrorCopy(new ApiError(503, "", "meta_not_connected"), "cover")).toBe("Making a cover uses Meta's models. Add your key to try it.");
    expect(mediaErrorCopy(new ApiError(502, ""), "cover")).toBe("Couldn't make a cover just now. Try again in a moment.");
  });
});

describe("modelsConnected", () => {
  it("trusts the server's flag when it sends one", () => {
    expect(modelsConnected({ metaConnected: false })).toBe(false);
    expect(modelsConnected({ metaConnected: true })).toBe(true);
  });
  it("is connected with a key in this browser, whatever the server has", () => {
    saveKey("sk-visitor");
    expect(modelsConnected({ metaConnected: false })).toBe(true);
    forgetKey();
    expect(modelsConnected({ metaConnected: false })).toBe(false);
  });
  it("assumes yes until a media request comes back not connected", () => {
    expect(modelsConnected(undefined)).toBe(true);
    mediaErrorCopy(new ApiError(503, "Meta API key isn't configured"), "photo");
    expect(modelsConnected(undefined)).toBe(false);
    expect(modelsConnected({ metaConnected: true })).toBe(true);
  });
});

describe("AI actions", () => {
  it("open the key dialog instead of an error when nothing is connected", () => {
    expect(readyForAi("photo", { metaConnected: false })).toBe(false);
    expect(getUi().keyDialog?.reason).toMatch(/Add your key/);
    expect(getNotices()).toHaveLength(0);
  });
  it("go ahead with a key", () => {
    saveKey("sk-visitor");
    expect(readyForAi("cover", { metaConnected: false })).toBe(true);
    expect(getUi().keyDialog).toBeNull();
  });
  it("treat a 503 meta_not_connected as a request for a key", () => {
    expect(handledAiRefusal(new ApiError(503, "No key", "meta_not_connected"), "voice")).toBe(true);
    expect(getUi().keyDialog?.reason).toMatch(/Voice uses Meta's models/);
    expect(handledAiRefusal(new ApiError(502, "Bad gateway"), "voice")).toBe(false);
  });
  it("explain calmly that the demo is read-only", () => {
    setDemo({ notebook: "demo" });
    saveKey("sk-visitor");
    expect(readyForAi("photo", { metaConnected: true })).toBe(false);
    expect(getNotices()[0]?.text).toMatch(/recorded demo/);
    expect(getNotices()[0]?.tone).not.toBe("error");
    expect(getUi().keyDialog).toBeNull();
  });
});
