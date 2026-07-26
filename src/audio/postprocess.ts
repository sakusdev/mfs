export type ChordCandidate = { chord: string; confidence: number };
export type ChordSegment = {
  start: number;
  end: number;
  chord: string;
  confidence: number;
  candidates: ChordCandidate[];
  bar: number;
  beat: number;
};
export type MelodyNote = {
  start: number;
  end: number;
  midi: number;
  note: string;
  frequency: number;
  confidence: number;
};
export type AnalysisResult = {
  duration: number;
  sampleRate: number;
  tempo: number;
  key: string;
  beatDuration: number;
  beatOffset: number;
  beatsPerBar: number;
  beatUnit: number;
  timeSignature: string;
  meterConfidence: number;
  chords: ChordSegment[];
  melody?: MelodyNote[];
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function refreshNote(note: MelodyNote, midi = note.midi): MelodyNote {
  return {
    ...note,
    midi,
    note: midiName(midi),
    frequency: 440 * 2 ** ((midi - 69) / 12),
  };
}

function mergeChordRuns(chords: ChordSegment[]): ChordSegment[] {
  const output: ChordSegment[] = [];
  for (const item of chords) {
    const previous = output.at(-1);
    if (previous && previous.chord === item.chord && item.start - previous.end <= 0.08) {
      previous.end = Math.max(previous.end, item.end);
      previous.confidence = Math.max(previous.confidence, item.confidence);
      previous.candidates = previous.candidates.length >= item.candidates.length ? previous.candidates : item.candidates;
    } else {
      output.push({ ...item, candidates: [...item.candidates] });
    }
  }
  return output;
}

function absorbShortNoChord(chords: ChordSegment[], beatDuration: number): ChordSegment[] {
  const threshold = Math.max(0.18, beatDuration * 0.55);
  const output = chords.map((item) => ({ ...item, candidates: [...item.candidates] }));
  for (let index = 0; index < output.length; index += 1) {
    const item = output[index];
    if (item.chord !== "N" || item.end - item.start >= threshold) continue;
    const previous = output[index - 1];
    const next = output[index + 1];
    let replacement: ChordSegment | undefined;
    if (previous?.chord !== "N" && next?.chord !== "N" && previous?.chord === next?.chord) replacement = previous;
    else if (previous?.chord !== "N" && next?.chord !== "N") replacement = previous.confidence >= next.confidence ? previous : next;
    else if (previous?.chord !== "N") replacement = previous;
    else if (next?.chord !== "N") replacement = next;
    if (replacement) {
      item.chord = replacement.chord;
      item.confidence = Math.max(0.5, replacement.confidence * 0.9);
      item.candidates = replacement.candidates;
    }
  }
  return output;
}

function quantizeChordTimes(chords: ChordSegment[], result: AnalysisResult): ChordSegment[] {
  const grid = Math.max(0.08, result.beatDuration / 2);
  return chords.map((item, index) => {
    const start = result.beatOffset + Math.round((item.start - result.beatOffset) / grid) * grid;
    const rawEnd = result.beatOffset + Math.round((item.end - result.beatOffset) / grid) * grid;
    const end = Math.max(start + grid, rawEnd);
    const halfBeat = Math.max(0, Math.round((start - result.beatOffset) / grid));
    const beatIndex = Math.floor(halfBeat / 2);
    return {
      ...item,
      start: Math.max(0, start),
      end: Math.min(result.duration, index === chords.length - 1 ? result.duration : end),
      bar: Math.floor(beatIndex / result.beatsPerBar) + 1,
      beat: (beatIndex % result.beatsPerBar) + 1,
    };
  });
}

function cleanMelody(notes: MelodyNote[], result: AnalysisResult): MelodyNote[] {
  if (!notes.length) return [];
  const grid = Math.max(0.04, result.beatDuration / 4);
  const minimumLength = Math.max(0.07, grid * 0.55);
  let cleaned = notes
    .filter((note) => note.end > note.start && note.confidence >= 0.28)
    .map((note) => {
      const start = Math.max(0, Math.round(note.start / grid) * grid);
      const end = Math.min(result.duration, Math.max(start + grid, Math.round(note.end / grid) * grid));
      return { ...note, start, end };
    })
    .filter((note) => note.end - note.start >= minimumLength)
    .sort((a, b) => a.start - b.start);

  // 単発の大きな飛び音は前後の中央値へ寄せる。
  cleaned = cleaned.map((note, index, all) => {
    const previous = all[index - 1];
    const next = all[index + 1];
    if (!previous || !next) return note;
    const neighboursClose = Math.abs(previous.midi - next.midi) <= 2;
    const isolatedLeap = Math.abs(note.midi - previous.midi) >= 9 && Math.abs(note.midi - next.midi) >= 9;
    const short = note.end - note.start <= grid * 1.5;
    if (neighboursClose && isolatedLeap && short) return refreshNote(note, Math.round((previous.midi + next.midi) / 2));
    return note;
  });

  const output: MelodyNote[] = [];
  for (const note of cleaned) {
    const previous = output.at(-1);
    if (previous && previous.midi === note.midi && note.start - previous.end <= grid * 0.75) {
      previous.end = Math.max(previous.end, note.end);
      previous.confidence = Math.max(previous.confidence, note.confidence);
    } else {
      output.push({ ...note });
    }
  }
  return output;
}

export function postprocessAnalysis(input: AnalysisResult): AnalysisResult {
  const quantized = quantizeChordTimes(input.chords ?? [], input);
  const chords = mergeChordRuns(absorbShortNoChord(mergeChordRuns(quantized), input.beatDuration));
  return {
    ...input,
    chords,
    melody: cleanMelody(input.melody ?? [], input),
  };
}
