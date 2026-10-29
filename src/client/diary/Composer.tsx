import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, FileText, ImagePlus, Loader2, Mic, Square, ScanText, X } from "lucide-react";
import type { Agent, Attachment } from "@shared/types";
import { api, isNotFound } from "../lib/api";
import { prefersReducedMotion } from "../lib/ui";
import { mediaErrorCopy, usePhotoImport } from "../lib/media";
import { canRecord, startRecording, type Recording } from "./recorder";
import { Picker } from "./Picker";

export interface PendingAttachment {
  key: string;
  name: string;
  previewUrl: string;
  status: "uploading" | "ready" | "failed";
  attachment?: Attachment;
}

export interface ComposerHandle {
  focus(): void;
  setText(text: string): void;
}

interface Props {
  agents: Agent[];
  agentId: string | null;
  onAgent(id: string | null): void;
  busy: boolean;
  sending: boolean;
  sinking: string | null;
  onSinkDone(): void;
  onSend(text: string, attachments: Attachment[]): void;
  onStop(): void;
  context: { id: string; title: string } | null;
  onClearContext(): void;
  restoreDraft: string | null;
  onDraftRestored(): void;
  onNote(note: string | null): void;
}

// Optional server features: once we learn a route is missing, stop offering it this session.
const missing = new Set<string>(JSON.parse(sessionStorage.getItem("inkwell-missing") ?? "[]"));
const markMissing = (name: string) => {
  missing.add(name);
  sessionStorage.setItem("inkwell-missing", JSON.stringify([...missing]));
};

/** Your words, sinking into the paper word by word. */
function Sinking({ text, onDone }: { text: string; onDone(): void }) {
  const words = text.split(/(\s+)/);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const total = prefersReducedMotion() ? 250 : Math.min(1800, 900 + words.length * 22);
    const t = setTimeout(() => done.current(), total);
    return () => clearTimeout(t);
  }, [text, words.length]);
  let w = 0;
  return (
    <p className="sinking" aria-hidden>
      {words.map((part, i) =>
        /^\s+$/.test(part) ? (
          part
        ) : (
          <span key={i} className="sink-word" style={{ ["--i" as string]: Math.min(w++, 40) }}>
            {part}
          </span>
        ),
      )}
    </p>
  );
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(props, ref) {
  const { agents, agentId, onAgent, busy, sending, sinking, onSinkDone, onSend, onStop, context, onClearContext, restoreDraft, onDraftRestored, onNote } = props;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [mic, setMic] = useState<"idle" | "recording" | "transcribing">("idle");
  const [micOk, setMicOk] = useState(() => canRecord() && !missing.has("transcribe"));
  const [uploadsOk, setUploadsOk] = useState(() => !missing.has("uploads"));
  const [seconds, setSeconds] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recording = useRef<Recording | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    setText: (t) => {
      setText(t);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(t.length, t.length);
      });
    },
  }));

  useEffect(() => {
    if (restoreDraft == null) return;
    setText((cur) => (cur.trim() ? cur : restoreDraft));
    onDraftRestored();
  }, [restoreDraft, onDraftRestored]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  useEffect(() => {
    if (mic !== "recording") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [mic]);

  useEffect(() => () => recording.current?.cancel(), []);

  // Muse Voice Transcribe takes up to ten minutes; stop a little before.
  const toggleRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (mic === "recording" && seconds >= 590) toggleRef.current();
  }, [mic, seconds]);
  const importPhoto = usePhotoImport();

  const uploading = files.some((f) => f.status === "uploading");
  const canSend = !!text.trim() && !sending && !uploading;

  const submit = () => {
    if (!canSend) return;
    const ready = files.flatMap((f) => (f.status === "ready" && f.attachment ? [f.attachment] : []));
    onSend(text.trim(), ready);
    setText("");
    files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    setFiles([]);
  };

  const addFiles = (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      if (!file.type.startsWith("image/")) continue;
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setFiles((fs) => [...fs, { key, name: file.name, previewUrl: URL.createObjectURL(file), status: "uploading" }]);
      api
        .upload(file)
        .then((attachment) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, status: "ready", attachment } : f))))
        .catch((e) => {
          if (isNotFound(e)) {
            markMissing("uploads");
            setUploadsOk(false);
            setFiles((fs) => fs.filter((f) => f.key !== key));
            onNote("Pictures can't be attached on this server yet.");
          } else {
            setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, status: "failed" } : f)));
            onNote(mediaErrorCopy(e, "photo"));
          }
        });
    }
  };

  const toggleMic = async () => {
    if (mic === "recording") {
      const rec = recording.current;
      recording.current = null;
      if (!rec) return;
      setMic("transcribing");
      try {
        const wav = await rec.stop();
        const { text: heard } = await api.transcribe(wav);
        setText((t) => (t.trim() ? `${t.trimEnd()} ${heard}` : heard));
        area.current?.focus();
      } catch (e) {
        if (isNotFound(e)) {
          markMissing("transcribe");
          setMicOk(false);
          onNote("Voice isn't available on this server yet. Type instead.");
        } else onNote(mediaErrorCopy(e, "voice"));
      } finally {
        setMic("idle");
      }
      return;
    }
    try {
      recording.current = await startRecording();
      setMic("recording");
      onNote(null);
    } catch {
      onNote("The microphone is blocked. Allow it in your browser to speak to the diary.");
    }
  };

  toggleRef.current = () => void toggleMic();
  const agent = agents.find((a) => a.id === agentId);

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={(e) => uploadsOk && e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!uploadsOk || !e.dataTransfer.files.length) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      {context && (
        <div className="context-chip">
          <FileText size={13} aria-hidden />
          <span>
            About <strong>{context.title}</strong>
          </span>
          <button type="button" aria-label="Don't include this page" onClick={onClearContext}>
            <X size={13} aria-hidden />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <ul className="pending-files" aria-label="Attached pictures">
          {files.map((f) => (
            <li key={f.key} data-status={f.status}>
              <img src={f.previewUrl} alt={f.name} />
              {f.status === "uploading" && <Loader2 size={16} className="spin" aria-label="Uploading" />}
              {f.status === "failed" && <span className="file-failed">Failed</span>}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => {
                  URL.revokeObjectURL(f.previewUrl);
                  setFiles((fs) => fs.filter((x) => x.key !== f.key));
                }}
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="writing-line">
        {sinking && <Sinking text={sinking} onDone={onSinkDone} />}
        <textarea
          ref={area}
          className="composer-input"
          rows={2}
          value={text}
          placeholder={mic === "recording" ? "Listening…" : "Write to me…"}
          aria-label="Write in the diary"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (uploadsOk && e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div className="composer-tools">
        <Picker
          label="Which agent writes back"
          value={agentId}
          onChange={onAgent}
          placement="above"
          className="agent-picker"
          button={
            <>
              <span className="agent-dot" style={{ background: agent?.color ?? "var(--ink-faint)" }} aria-hidden />
              <span>{agent?.name ?? "Any agent"}</span>
            </>
          }
          options={[
            { value: null, label: "Any agent", detail: "The diary picks who's best for it", lead: <span className="agent-dot any" aria-hidden /> },
            ...agents.map((a) => ({
              value: a.id as string | null,
              label: <span className="hand-name agent-ink" style={{ ["--agent" as string]: a.color }}>{a.name}</span>,
              detail: a.description,
              lead: <span className="agent-dot" style={{ background: a.color }} aria-hidden />,
            })),
          ]}
        />
        <span className="tools-spacer" />
        {uploadsOk && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button type="button" className="tool-button" aria-label="Attach a picture" title="Attach a picture" onClick={() => fileInput.current?.click()}>
              <ImagePlus size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="tool-button"
              aria-label="Turn a photo of notes into map cards"
              title="Turn a photo of notes into map cards"
              onClick={() => importPhoto()}
            >
              <ScanText size={18} aria-hidden />
            </button>
          </>
        )}
        {micOk && (
          <button
            type="button"
            className="tool-button"
            data-state={mic}
            aria-label={mic === "recording" ? "Stop and transcribe" : mic === "transcribing" ? "Transcribing" : "Speak to the diary"}
            title={mic === "recording" ? "Stop and transcribe" : "Speak to the diary"}
            disabled={mic === "transcribing"}
            onClick={toggleMic}
          >
            {mic === "transcribing" ? <Loader2 size={18} className="spin" aria-hidden /> : <Mic size={18} aria-hidden />}
            {mic === "recording" && <span className="rec-time">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>}
          </button>
        )}
        {busy && !text.trim() ? (
          <button type="button" className="send-button stop" aria-label="Stop the agent" title="Stop the agent" onClick={onStop}>
            <Square size={14} aria-hidden fill="currentColor" />
          </button>
        ) : (
          <button type="submit" className="send-button" aria-label="Send" title="Send (Enter)" disabled={!canSend}>
            <ArrowUp size={18} aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
});
