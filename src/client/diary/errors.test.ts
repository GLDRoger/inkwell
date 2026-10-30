import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { cancelErrorCopy, runErrorCopy, sendErrorCopy } from "./errors";

describe("sendErrorCopy", () => {
  it("never says the server isn't running the agents on a 404", () => {
    for (const e of [new ApiError(404, "Not found.", "not_found"), new ApiError(404, "Not Found"), new ApiError(404, "page not found")]) {
      const { message } = sendErrorCopy(e);
      expect(message).not.toMatch(/server|isn't running/i);
      expect(message).toMatch(/Your words are still here\.$/);
    }
  });

  it("adopts the server's codes", () => {
    expect(sendErrorCopy(new ApiError(404, "That conversation no longer exists. Start a new one.", "thread_not_found"))).toMatchObject({
      reset: "thread",
      message: expect.stringContaining("start a new one"),
    });
    expect(sendErrorCopy(new ApiError(404, "x", "agent_not_found")).reset).toBe("agent");
    expect(sendErrorCopy(new ApiError(404, "x", "page_not_found")).reset).toBe("page");
    expect(sendErrorCopy(new ApiError(503, "Inkwell is restarting. Try again in a moment.", "restarting"))).toMatchObject({
      kind: "unavailable",
      message: "Inkwell is restarting. Try again in a moment. Your words are still here.",
    });
  });

  it("shows the server's plain sentence, but not raw internals", () => {
    expect(sendErrorCopy(new ApiError(400, "The agent couldn't start: That page no longer exists.", "agent_unavailable")).message).toBe(
      "The agent couldn't start: That page no longer exists. Your words are still here.",
    );
    expect(sendErrorCopy(new ApiError(500, "TypeError: cannot read properties of undefined")).message).toBe(
      "Something went wrong sending that. Try again. Your words are still here.",
    );
    expect(sendErrorCopy(new ApiError(400, "invalid body")).message).toBe("Something went wrong sending that. Try again. Your words are still here.");
    expect(sendErrorCopy(new Error("boom")).message).toMatch(/^Something went wrong/);
  });

  it("says when you're offline", () => {
    expect(sendErrorCopy(new ApiError(0, "Can't reach the server."))).toMatchObject({ kind: "offline" });
  });
});

describe("runErrorCopy", () => {
  it("explains a missing key in the diary's voice", () => {
    expect(runErrorCopy("The Meta API key isn't configured. Set META_API_KEY to let the agents work.")).toBe(
      "The agents aren't connected yet, so they can't write back. Your words are saved.",
    );
  });
  it("names the model when the provider fails", () => {
    expect(runErrorCopy("The Meta model couldn't complete this request. Check the API configuration and try again.")).toBe(
      "Muse Spark couldn't finish this one. Try again in a moment.",
    );
  });
  it("passes the runtime's own plain sentences through", () => {
    expect(runErrorCopy("Agent handoff limit reached. Finish with the information available.")).toBe(
      "Agent handoff limit reached. Finish with the information available.",
    );
    expect(runErrorCopy("")).toBe("Stopped with an error. Try again.");
  });
});

describe("cancelErrorCopy", () => {
  it("doesn't blame the server", () => {
    expect(cancelErrorCopy(new ApiError(404, "x"))).toBe("That run has already finished.");
  });
});
