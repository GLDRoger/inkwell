import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { cancelErrorCopy, runErrorCopy, runRecovery, sendErrorCopy } from "./errors";

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
      "The agents aren't connected yet, so they can't write back. Your request is saved.",
    );
  });
  it("names the model when the provider fails", () => {
    const failed = "The Meta model couldn't complete this request. Check the API configuration and try again.";
    expect(runErrorCopy(failed)).toBe("Muse Wonder couldn't finish this one.");
    expect(runErrorCopy(failed, "muse-spark-1.3-contributor")).toBe("Muse Spark couldn't finish this one.");
  });
  it("passes the runtime's own plain sentences through", () => {
    expect(runErrorCopy("Agent handoff limit reached. Finish with the information available.")).toBe(
      "Agent handoff limit reached. Finish with the information available.",
    );
    expect(runErrorCopy("")).toBe("Something went wrong before this was finished.");
  });
  it("leaves the next step to the button beside it", () => {
    expect(runErrorCopy("The agent ran out of time. Ask it to continue from the changes already made.")).toBe("The agent ran out of time.");
    expect(runErrorCopy("Interrupted by a server restart.")).toBe("Inkwell restarted while this was being written.");
  });
});

describe("runRecovery", () => {
  it("offers Try again, Continue, or nothing when retrying can't help", () => {
    expect(runRecovery("The Meta model couldn't complete this request. Check the API configuration and try again.")).toBe("retry");
    expect(runRecovery(null)).toBe("retry");
    expect(runRecovery("The agent reached its step limit. Ask it to continue from the changes already made.")).toBe("continue");
    expect(runRecovery("The agent reached its reply length limit. Ask it to continue.")).toBe("continue");
    expect(runRecovery("The Meta API key isn't configured. Set META_API_KEY to let the agents work.")).toBeNull();
  });
});

describe("sendErrorCopy on a retry", () => {
  it("doesn't promise the words are back in the composer", () => {
    expect(sendErrorCopy(new ApiError(0, "x"), { kept: false }).message).toBe("Couldn't reach Inkwell. Check your connection and try again.");
  });
});

describe("cancelErrorCopy", () => {
  it("doesn't blame the server", () => {
    expect(cancelErrorCopy(new ApiError(404, "x"))).toBe("That run has already finished.");
  });
});
