import { useEffect, useMemo, useRef } from "react";

export type MelodyNote = {
  start: number;
  end: number;
  midi: number;
  note: string;
  frequency: number;
  confidence: number;
};

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function refreshNote(note: MelodyNote, midi: number): MelodyNote {
  return { ...note, midi, note: midiName(midi), frequency: 440 * 2 ** ((midi - 69) / 12) };
}

function simplifyNotes(notes: MelodyNote[]): MelodyNote[] {
  if (!notes.length) return [];
  const cleaned = notes.filter((note) => note.end - note.start >= 0.07 && note.confidence >= 0.28);
  const corrected = cleaned.map((note, index, all) => {
    const previous = all[index - 1];
    const next = all[index + 1];
    if (!previous || !next) return note;
    const isolated = Math.abs(note.midi - previous.midi) >= 9 && Math.abs(note.midi - next.midi) >= 9;
    const neighboursAgree = Math.abs(previous.midi - next.midi) <= 2;
    if (isolated && neighboursAgree && note.end - note.start < 0.2) {
      return refreshNote(note, Math.round((previous.midi + next.midi) / 2));
    }
    return note;
  });
  const output: MelodyNote[] = [];
  for (const note of corrected) {
    const previous = output.at(-1);
    if (previous && previous.midi === note.midi && note.start - previous.end <= 0.08) {
      previous.end = Math.max(previous.end, note.end);
      previous.confidence = Math.max(previous.confidence, note.confidence);
    } else output.push({ ...note });
  }
  return output;
}

function StaffPreview({ notes, duration, onSeek }: { notes: MelodyNote[]; duration: number; onSeek: (seconds: number) => void }) {
  const visible = notes.slice(0, 160);
  const minimum = Math.min(...visible.map((note) => note.midi), 60);
  const maximum = Math.max(...visible.map((note) => note.midi), 72);
  const range = Math.max(12, maximum - minimum);
  return <div className="staffPreview" aria-label="簡易五線譜">
    {[0, 1, 2, 3, 4].map((line) => <i key={line} style={{ top: `${22 + line * 14}%` }} />)}
    {visible.map((note, index) => {
      const left = duration > 0 ? note.start / duration * 100 : 0;
      const top = 82 - (note.midi - minimum) / range * 68;
      return <button
        key={`${note.start}-${index}`}
        className="staffNote"
        title={`${note.note} ${note.start.toFixed(2)}s`}
        style={{ left: `${Math.min(98, Math.max(1, left))}%`, top: `${Math.min(90, Math.max(5, top))}%` }}
        onClick={() => onSeek(note.start)}
      ><span>{note.note}</span></button>;
    })}
  </div>;
}

export default function MelodyPanel({ notes, duration, currentTime, onSeek, onChange }: {
  notes: MelodyNote[];
  duration: number;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onChange: (notes: MelodyNote[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimum = Math.min(...notes.map((note) => note.midi), 48) - 2;
  const maximum = Math.max(...notes.map((note) => note.midi), 72) + 2;
  const averageConfidence = useMemo(() => notes.length ? notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length : 0, [notes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0b1120";
    context.fillRect(0, 0, width, height);
    const rows = Math.max(1, maximum - minimum + 1);
    for (let midi = minimum; midi <= maximum; midi += 1) {
      const y = height - ((midi - minimum + 1) / rows) * height;
      context.strokeStyle = midi % 12 === 0 ? "#35415e" : "#202a40";
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    for (const note of notes) {
      const x = duration > 0 ? note.start / duration * width : 0;
      const w = Math.max(2, (note.end - note.start) / Math.max(duration, 0.001) * width);
      const y = height - ((note.midi - minimum + 1) / rows) * height;
      const h = Math.max(5, height / rows - 2);
      context.fillStyle = currentTime >= note.start && currentTime < note.end ? "#d8e2ff" : "#8ca9ff";
      context.fillRect(x, y + 1, w, h);
    }
    const playX = duration > 0 ? currentTime / duration * width : 0;
    context.fillStyle = "#fff";
    context.fillRect(playX, 0, 1, height);
  }, [currentTime, duration, maximum, minimum, notes]);

  return <div className="panel melodyPanel">
    <div className="panelTitle">
      <h2>メロディ</h2>
      <div className="panelButtons">
        <span>{notes.length} notes / 平均{Math.round(averageConfidence * 100)}%</span>
        <button className="secondary" disabled={!notes.length} onClick={() => onChange(simplifyNotes(notes))}>ノイズ音を整理</button>
      </div>
    </div>
    <StaffPreview notes={notes} duration={duration} onSeek={onSeek} />
    <canvas ref={canvasRef} className="pianoRoll" onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      onSeek((event.clientX - rect.left) / rect.width * duration);
    }} />
    <div className="melodyNotes">
      {notes.map((note, index) => <div className={`melodyNote ${currentTime >= note.start && currentTime < note.end ? "active" : ""}`} key={`${note.start}-${index}`} onClick={() => onSeek(note.start)}>
        <input type="number" min="24" max="108" value={note.midi} onClick={(event) => event.stopPropagation()} onChange={(event) => {
          const midi = Math.max(24, Math.min(108, Number(event.target.value)));
          onChange(notes.map((item, itemIndex) => itemIndex === index ? refreshNote(item, midi) : item));
        }} />
        <strong>{note.note}</strong>
        <span>{note.start.toFixed(2)}–{note.end.toFixed(2)}s</span>
        <small>{Math.round(note.confidence * 100)}%</small>
      </div>)}
    </div>
  </div>;
}
