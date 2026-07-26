import { useEffect, useRef } from "react";

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
    <div className="panelTitle"><h2>メロディ</h2><span>{notes.length} notes / 主旋律推定</span></div>
    <canvas ref={canvasRef} className="pianoRoll" onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      onSeek((event.clientX - rect.left) / rect.width * duration);
    }} />
    <div className="melodyNotes">
      {notes.map((note, index) => <div className={`melodyNote ${currentTime >= note.start && currentTime < note.end ? "active" : ""}`} key={`${note.start}-${index}`} onClick={() => onSeek(note.start)}>
        <input type="number" min="24" max="108" value={note.midi} onClick={(event) => event.stopPropagation()} onChange={(event) => {
          const midi = Math.max(24, Math.min(108, Number(event.target.value)));
          onChange(notes.map((item, itemIndex) => itemIndex === index ? { ...item, midi, note: midiName(midi), frequency: 440 * 2 ** ((midi - 69) / 12) } : item));
        }} />
        <strong>{note.note}</strong>
        <span>{note.start.toFixed(2)}–{note.end.toFixed(2)}s</span>
        <small>{Math.round(note.confidence * 100)}%</small>
      </div>)}
    </div>
  </div>;
}
