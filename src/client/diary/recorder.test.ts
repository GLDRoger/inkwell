import { describe, expect, it } from "vitest";
import { encodeWav } from "./recorder";

// The server's own WAV check, loaded by path so the client's types stay browser-only.
const SERVER_TRANSCRIBE = "../../server/media/transcribe.ts";
type Validate = (bytes: Uint8Array) => void;

// jsdom's Blob has no arrayBuffer(); FileReader works everywhere.
function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe("encodeWav", () => {
  it("writes 16 kHz mono 16-bit PCM that the transcribe route accepts", async () => {
    const rate = 16_000;
    const samples = new Float32Array(rate / 2).map((_, i) => Math.sin(i / 8) * 0.5);
    const bytes = await bytesOf(encodeWav(samples, rate));
    const v = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(rate);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(samples.length * 2);

    const { validateWav } = (await import(/* @vite-ignore */ SERVER_TRANSCRIBE)) as { validateWav: Validate };
    const NodeBuffer = (globalThis as unknown as { Buffer: { from(b: Uint8Array): Uint8Array } }).Buffer;
    expect(() => validateWav(NodeBuffer.from(bytes))).not.toThrow();
  });

  it("clips out-of-range samples instead of wrapping", async () => {
    const bytes = await bytesOf(encodeWav(new Float32Array([2, -2]), 16_000));
    const v = new DataView(bytes.buffer);
    expect(v.getInt16(44, true)).toBe(0x7fff);
    expect(v.getInt16(46, true)).toBe(-0x8000);
  });
});
