const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };

export function transposeNote(note: string, semitones: number): string {
  const normalized = FLATS[note] ?? note;
  const index = NOTES.indexOf(normalized);
  if (index < 0) return note;
  return NOTES[(index + semitones % 12 + 12) % 12];
}

export function transposeChord(chord: string, semitones: number): string {
  if (!chord || chord === "N") return chord;
  const match = chord.match(/^([A-G](?:#|b)?)(.*?)(?:\/([A-G](?:#|b)?))?$/);
  if (!match) return chord;
  const [, root, suffix, bass] = match;
  return `${transposeNote(root, semitones)}${suffix}${bass ? `/${transposeNote(bass, semitones)}` : ""}`;
}

export function transposeKey(key: string, semitones: number): string {
  const match = key.match(/^([A-G](?:#|b)?)(.*)$/);
  return match ? `${transposeNote(match[1], semitones)}${match[2]}` : key;
}

export function chordToMidiNotes(chord: string): number[] {
  if (!chord || chord === "N") return [];
  const main = chord.split("/")[0];
  const match = main.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match) return [];
  const root = NOTES.indexOf(FLATS[match[1]] ?? match[1]);
  if (root < 0) return [];
  const quality = match[2];
  let intervals = [0, 4, 7];
  if (quality.startsWith("m") && !quality.startsWith("maj")) intervals = [0, 3, 7];
  if (quality.includes("dim")) intervals = [0, 3, 6];
  if (quality.includes("sus4")) intervals = [0, 5, 7];
  if (quality.includes("maj7")) intervals.push(11);
  else if (quality.includes("7")) intervals.push(10);
  return intervals.map((interval) => 60 + root + interval);
}
