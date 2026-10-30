import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { TEXT_MODELS, type TextModelId } from "@shared/types";
import { api } from "../lib/api";
import { cleanKey, forgetKey, saveKey, textModelName, useMetaKey } from "../lib/key";
import { notify } from "../lib/notices";
import { setUi, useUi } from "../lib/ui";

export const KEY_COPY = {
  title: "Use your Meta API key",
  lede: "The agents, voice and photo reading run on Meta's models. Add your own key to use them in your notebook.",
  keyLabel: "API key",
  placeholder: "Paste your key",
  getKey: "Get a key at dev.meta.ai",
  modelLabel: "Model",
  models: {
    "muse-wonder-1.0": "The best results. Recommended.",
    "muse-spark-1.3-contributor": "Far cheaper. Meta may use what you send to train its models.",
  } satisfies Record<TextModelId, string>,
  privacy: "Your key stays in this browser. It's sent only with your own requests and never saved on our server.",
  check: "Check key",
  checking: "Checking…",
  works: "That key works.",
  save: "Save",
  forget: "Forget key",
  cancel: "Cancel",
  saved: (model: string) => `Key saved. Your agents will write with ${model}.`,
  forgotten: "Key forgotten. It's gone from this browser.",
} as const;

/** Why the check failed, in one sentence: Meta's answer, or that the check itself didn't happen. */
export function checkFailedCopy(error: unknown): string {
  if (typeof error === "string" && error.trim()) return `Meta didn't accept that key: ${error.trim().replace(/\.?$/, ".")}`;
  if (error && typeof error === "object" && "status" in error) {
    return (error as { status: number }).status === 0
      ? "Couldn't reach Inkwell to check. You can still save the key."
      : "Couldn't check the key just now. You can still save it.";
  }
  return "Meta didn't accept that key. Check that you copied all of it.";
}

/** The dialog behind every "Add your key": from the guide, the brand menu, or an AI action without a key. */
export function KeyDialog() {
  const request = useUi((s) => s.keyDialog ?? null);
  const ref = useRef<HTMLDialogElement>(null);
  const open = !!request;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);

  const close = () => setUi({ keyDialog: null });

  return (
    <dialog
      ref={ref}
      className="key-dialog"
      aria-labelledby="key-title"
      onClose={close}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === ref.current && close()}
    >
      {open && <KeyForm reason={request?.reason} onDone={close} />}
    </dialog>
  );
}

type Check = { state: "idle" } | { state: "checking" } | { state: "ok" } | { state: "failed"; message: string };

function KeyForm({ reason, onDone }: { reason?: string; onDone(): void }) {
  const saved = useMetaKey();
  const [value, setValue] = useState(saved.key ?? "");
  const [model, setModel] = useState<TextModelId>(saved.model);
  const [shown, setShown] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const statusId = useId();
  const key = cleanKey(value);

  useEffect(() => {
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  const runCheck = async () => {
    if (!key) return;
    setCheck({ state: "checking" });
    try {
      const res = await api.checkKey(key);
      setCheck(res.ok ? { state: "ok" } : { state: "failed", message: checkFailedCopy(res.error) });
    } catch (e) {
      setCheck({ state: "failed", message: checkFailedCopy(e) });
    }
  };

  return (
    <form
      className="key-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (!key) return;
        saveKey(key, model);
        notify({ tone: "done", id: "meta-key", text: KEY_COPY.saved(textModelName(model)) });
        onDone();
      }}
    >
      <header className="key-head">
        <h2 id="key-title" className="key-title">
          {KEY_COPY.title}
        </h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onDone}>
          <X size={17} aria-hidden />
        </button>
      </header>
      <p className="key-lede">{reason ?? KEY_COPY.lede}</p>

      <label className="key-label" htmlFor="meta-key-input">
        {KEY_COPY.keyLabel}
      </label>
      <div className="key-field">
        <input
          ref={input}
          id="meta-key-input"
          className="key-input"
          type={shown ? "text" : "password"}
          value={value}
          placeholder={KEY_COPY.placeholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={`${hintId} ${statusId}`}
          onChange={(e) => {
            setValue(e.target.value);
            setCheck({ state: "idle" });
          }}
        />
        <button
          type="button"
          className="key-show"
          aria-label={shown ? "Hide the key" : "Show the key"}
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
      <p id={hintId} className="key-hint">
        <a href="https://dev.meta.ai" target="_blank" rel="noopener noreferrer">
          {KEY_COPY.getKey}
          <ArrowUpRight size={13} aria-hidden />
        </a>
      </p>
      <p id={statusId} className="key-status" data-state={check.state} role="status" aria-live="polite">
        {check.state === "checking" && (
          <>
            <Loader2 size={14} className="spin" aria-hidden /> {KEY_COPY.checking}
          </>
        )}
        {check.state === "ok" && (
          <>
            <Check size={14} aria-hidden /> {KEY_COPY.works}
          </>
        )}
        {check.state === "failed" && check.message}
      </p>

      <fieldset className="key-models">
        <legend className="key-label">{KEY_COPY.modelLabel}</legend>
        {TEXT_MODELS.map((m) => (
          <label key={m.id} className="key-model" data-checked={model === m.id || undefined}>
            <input type="radio" name="meta-model" value={m.id} checked={model === m.id} onChange={() => setModel(m.id)} />
            <span>
              <span className="key-model-name">{m.name}</span>
              <span className="key-model-detail">{KEY_COPY.models[m.id]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <p className="key-privacy">{KEY_COPY.privacy}</p>

      <div className="key-actions">
        {saved.key && (
          <button
            type="button"
            className="link-button key-forget"
            onClick={() => {
              forgetKey();
              setValue("");
              setCheck({ state: "idle" });
              notify({ tone: "done", id: "meta-key", text: KEY_COPY.forgotten });
            }}
          >
            {KEY_COPY.forget}
          </button>
        )}
        <span className="key-spacer" />
        <button type="button" className="key-secondary" disabled={!key || check.state === "checking"} onClick={runCheck}>
          {KEY_COPY.check}
        </button>
        <button type="submit" className="key-primary" disabled={!key}>
          {KEY_COPY.save}
        </button>
      </div>
    </form>
  );
}
