import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KeyDialog, checkFailedCopy } from "./KeyDialog";
import { getUi, openKeyDialog, setUi } from "../lib/ui";
import { getKeyState, KEY_STORAGE, reloadKey } from "../lib/key";
import { ApiError } from "../lib/api";

const fetchMock = vi.fn();
beforeEach(() => {
  localStorage.clear();
  reloadKey();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUi({ keyDialog: null });
});

describe("the key dialog", () => {
  it("saves a pasted key and the model choice in this browser", () => {
    render(<KeyDialog />);
    act(() => openKeyDialog("Voice uses Meta's models. Add your key to try it, or type instead."));
    expect(screen.getByText(/Voice uses Meta's models/)).toBeTruthy();
    const input = screen.getByLabelText("API key") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "  sk-pasted  " } });
    fireEvent.click(screen.getByLabelText(/Muse Spark Contributor/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(localStorage.getItem(KEY_STORAGE)).toBe("sk-pasted");
    expect(getKeyState().model).toBe("muse-spark-1.3-contributor");
    expect(getUi().keyDialog).toBeNull();
  });

  it("describes both models plainly and says where the key goes", () => {
    render(<KeyDialog />);
    act(() => openKeyDialog());
    expect((screen.getByLabelText(/Muse Wonder/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Far cheaper\. Meta may use what you send to train its models\./)).toBeTruthy();
    expect(screen.getByText(/stays in this browser.*never saved on our server/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /dev\.meta\.ai/ }).getAttribute("href")).toBe("https://dev.meta.ai");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("checks the key with the server and says whether it works", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "Meta didn't accept that key. Check it and try again." }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<KeyDialog />);
    act(() => openKeyDialog());
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-bad" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check key" })));
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("X-Meta-Key")).toBe("sk-bad");
    expect(screen.getByText("Meta didn't accept that key. Check it and try again.")).toBeTruthy();
    // Checking doesn't save.
    expect(localStorage.getItem(KEY_STORAGE)).toBeNull();
  });

  it("forgets a saved key", () => {
    localStorage.setItem(KEY_STORAGE, "sk-old");
    reloadKey();
    render(<KeyDialog />);
    act(() => openKeyDialog());
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("sk-old");
    fireEvent.click(screen.getByRole("button", { name: "Forget key" }));
    expect(localStorage.getItem(KEY_STORAGE)).toBeNull();
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Forget key" })).toBeNull();
  });

  it("goes back to Muse Wonder when the key is forgotten", () => {
    localStorage.setItem(KEY_STORAGE, "sk-old");
    localStorage.setItem("inkwell-meta-model", "muse-spark-1.3-contributor");
    reloadKey();
    render(<KeyDialog />);
    act(() => openKeyDialog());
    expect((screen.getByLabelText(/Muse Spark Contributor/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Forget key" }));
    expect(getKeyState()).toEqual({ key: null, model: "muse-wonder-1.0" });
    expect(localStorage.getItem("inkwell-meta-model")).toBe("muse-wonder-1.0");
    expect((screen.getByLabelText(/Muse Wonder/) as HTMLInputElement).checked).toBe(true);
  });

  it("explains a failed check in one sentence", () => {
    expect(checkFailedCopy(new ApiError(0, ""))).toMatch(/Couldn't reach Inkwell/);
    expect(checkFailedCopy(new ApiError(404, "Not found"))).toBe("Couldn't check the key just now. You can still save it.");
    expect(checkFailedCopy(undefined)).toBe("Meta didn't accept that key. Check that you copied all of it.");
  });
});
