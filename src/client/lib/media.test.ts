import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { mediaErrorCopy, modelsConnected, resetModelsConnected } from "./media";

afterEach(resetModelsConnected);

describe("cover copy", () => {
  it("says make, not paint", () => {
    expect(mediaErrorCopy(new ApiError(503, ""), "cover")).toBe("Making a cover needs Meta's models, and this notebook isn't connected to them yet.");
    expect(mediaErrorCopy(new ApiError(502, ""), "cover")).toBe("Couldn't make a cover just now. Try again in a moment.");
  });
});

describe("modelsConnected", () => {
  it("trusts the server's flag when it sends one", () => {
    expect(modelsConnected({ metaConnected: false })).toBe(false);
    expect(modelsConnected({ metaConnected: true })).toBe(true);
  });
  it("assumes yes until a media request comes back not connected", () => {
    expect(modelsConnected(undefined)).toBe(true);
    mediaErrorCopy(new ApiError(503, "Meta API key isn't configured"), "photo");
    expect(modelsConnected(undefined)).toBe(false);
    expect(modelsConnected({ metaConnected: true })).toBe(true);
  });
});
