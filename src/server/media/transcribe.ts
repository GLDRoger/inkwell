import { mediaError, record, type MetaClient } from "./meta.ts";

const WAV_MESSAGE = "Audio must be a mono, 16-bit PCM WAV at 16 or 24 kHz; WebM is not supported. Record or convert to WAV first.";

/** Inspect RIFF chunks rather than trusting the MIME type or a fixed 44-byte header. */
export function validateWav(bytes: Buffer): void {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    mediaError(WAV_MESSAGE, 415);
  }
  let byteRate = 0;
  let dataSize = 0;
  const end = bytes.readUInt32LE(4) + 8;
  if (end > bytes.length) mediaError("Truncated WAV file", 400);
  for (let offset = 12; offset + 8 <= end;) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > end) mediaError("Truncated WAV file", 400);
    if (kind === "fmt ") {
      if (size < 16) mediaError(WAV_MESSAGE, 415);
      const rate = bytes.readUInt32LE(start + 4);
      if (bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 ||
          ![16_000, 24_000].includes(rate) || bytes.readUInt16LE(start + 14) !== 16 ||
          bytes.readUInt16LE(start + 12) !== 2 || bytes.readUInt32LE(start + 8) !== rate * 2) {
        mediaError(WAV_MESSAGE, 415);
      }
      byteRate = rate * 2;
    }
    if (kind === "data") dataSize += size;
    offset = start + size + (size % 2);
  }
  if (!byteRate || !dataSize || dataSize % 2) mediaError("WAV file has no valid audio samples", 400);
  if (dataSize / byteRate > 600) mediaError("Audio exceeds the 10-minute limit", 400);
}

export async function transcribe(audio: File, meta: MetaClient): Promise<{ text: string }> {
  const bytes = Buffer.from(await audio.arrayBuffer());
  validateWav(bytes);
  // https://dev.meta.ai/docs/speech-to-text: settings are a JSON multipart part,
  // not OpenAI's file/model fields. The response's canonical field is transcript.
  const form = new FormData();
  form.set("request", new Blob([JSON.stringify({
    model: process.env.META_TRANSCRIBE_MODEL ?? "muse-voice-transcribe-1.0",
    mode: "PUSH_TO_TALK",
    audioEncoding: "WAV",
  })], { type: "application/json" }), "request.json");
  form.set("audio", new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), "audio.wav");
  const result = record(await meta.post("/asr/transcribe", form));
  const text = result.transcript ?? result.text;
  if (typeof text === "string") return { text };
  if (Array.isArray(result.turns) && result.turns.every((turn) => typeof record(turn).transcript === "string")) {
    return { text: result.turns.map((turn) => record(turn).transcript).join(" ") };
  }
  mediaError("Meta returned no transcript");
}
