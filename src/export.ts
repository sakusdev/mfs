import { chordToMidiNotes } from "./music";

export type ExportChord = { start: number; end: number; chord: string; bar: number; beat: number; confidence: number };
export type ExportResult = { tempo: number; key: string; timeSignature: string; chords: ExportChord[] };

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(name: string, text: string, type = "text/plain;charset=utf-8"): void {
  downloadBlob(name, new Blob([text], { type }));
}

export function exportCsv(sourceName: string, result: ExportResult): void {
  const rows = ["start,end,bar,beat,chord,confidence"];
  for (const item of result.chords) rows.push([item.start.toFixed(3), item.end.toFixed(3), item.bar, item.beat, JSON.stringify(item.chord), item.confidence.toFixed(3)].join(","));
  downloadText(`${sourceName.replace(/\.[^.]+$/, "") || "analysis"}.csv`, rows.join("\n"), "text/csv;charset=utf-8");
}

function variableLength(value: number): number[] {
  let buffer = value & 0x7f;
  const output: number[] = [];
  while ((value >>= 7)) { buffer <<= 8; buffer |= (value & 0x7f) | 0x80; }
  while (true) { output.push(buffer & 0xff); if (buffer & 0x80) buffer >>= 8; else break; }
  return output;
}

function textMeta(type: number, text: string): number[] {
  const data = [...new TextEncoder().encode(text)];
  return [0, 0xff, type, ...variableLength(data.length), ...data];
}

export function exportMidi(sourceName: string, result: ExportResult): void {
  const ppq = 480;
  const events: Array<{ tick: number; bytes: number[]; order: number }> = [];
  const micros = Math.round(60_000_000 / Math.max(1, result.tempo));
  events.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255] });
  events.push({ tick: 0, order: 0, bytes: textMeta(0x03, sourceName).slice(1) });
  for (const item of result.chords) {
    const start = Math.max(0, Math.round(item.start * result.tempo / 60 * ppq));
    const end = Math.max(start + 1, Math.round(item.end * result.tempo / 60 * ppq));
    const notes = chordToMidiNotes(item.chord);
    for (const note of notes) {
      events.push({ tick: start, order: 1, bytes: [0x90, note, 72] });
      events.push({ tick: end, order: 0, bytes: [0x80, note, 0] });
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let previous = 0;
  for (const event of events) { track.push(...variableLength(event.tick - previous), ...event.bytes); previous = event.tick; }
  track.push(0, 0xff, 0x2f, 0);
  const header = [0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,(ppq>>8)&255,ppq&255];
  const length = track.length;
  const chunk = [0x4d,0x54,0x72,0x6b,(length>>>24)&255,(length>>>16)&255,(length>>>8)&255,length&255,...track];
  downloadBlob(`${sourceName.replace(/\.[^.]+$/, "") || "analysis"}.mid`, new Blob([new Uint8Array([...header, ...chunk])], { type: "audio/midi" }));
}
