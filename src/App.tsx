import { useEffect, useMemo, useRef, useState } from "react";

type ChordCandidate = { chord: string; confidence: number };
type ChordSegment = {
  start: number;
  end: number;
  chord: string;
  confidence: number;
  candidates: ChordCandidate[];
  bar: number;
  beat: number;
};
type AnalysisResult = {
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
};
type AnalysisProject = {
  format: "mfs-analysis";
  version: 1;
  sourceName: string;
  savedAt: string;
  result: AnalysisResult;
};
type WorkerResponse =
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; message: string };

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function buildPeaks(samples: Float32Array, count = 900): number[] {
  if (samples.length === 0) return [];
  const size = Math.max(1, Math.ceil(samples.length / count));
  const peaks: number[] = [];
  for (let start = 0; start < samples.length; start += size) {
    let peak = 0;
    const end = Math.min(start + size, samples.length);
    for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
    peaks.push(peak);
  }
  const maximum = Math.max(...peaks, 1e-6);
  return peaks.map((value) => value / maximum);
}

function markNoChord(result: AnalysisResult, peaks: number[]): AnalysisResult {
  if (peaks.length === 0 || result.duration <= 0) return result;
  const chords = result.chords.map((item) => {
    const from = Math.max(0, Math.floor((item.start / result.duration) * peaks.length));
    const to = Math.min(peaks.length, Math.ceil((item.end / result.duration) * peaks.length));
    const section = peaks.slice(from, Math.max(from + 1, to));
    const level = section.reduce((sum, value) => sum + value, 0) / Math.max(1, section.length);
    const noHarmony = level < 0.025 || item.confidence <= 0.5;
    if (!noHarmony) return item;
    return {
      ...item,
      chord: "N",
      confidence: Math.max(item.confidence, 0.55),
      candidates: [{ chord: "N", confidence: 0.75 }, ...item.candidates.filter((candidate) => candidate.chord !== "N")].slice(0, 3),
    };
  });
  return { ...result, chords };
}

function Waveform({ peaks, duration, currentTime, onSeek }: { peaks: number[]; duration: number; currentTime: number; onSeek: (seconds: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const center = height / 2;
    const progress = duration > 0 ? currentTime / duration : 0;
    const barWidth = width / peaks.length;
    for (let index = 0; index < peaks.length; index += 1) {
      const amplitude = Math.max(1, peaks[index] * (height * 0.43));
      context.fillStyle = index / peaks.length <= progress ? "#8ca9ff" : "#34415f";
      context.fillRect(index * barWidth, center - amplitude, Math.max(1, barWidth), amplitude * 2);
    }
    context.fillStyle = "#ffffff";
    context.fillRect(Math.min(width - 1, Math.max(0, progress * width)), 0, 1, height);
  }, [currentTime, duration, peaks]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - bounds.left) / bounds.width) * duration);
      }}
    />
  );
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState("Unknown");
  const [audioUrl, setAudioUrl] = useState("");
  const [status, setStatus] = useState("音源を選択してください");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const activeChordIndex = useMemo(() => {
    if (!result) return -1;
    return result.chords.findIndex((item) => currentTime >= item.start && currentTime < item.end);
  }, [currentTime, result]);

  const chordPro = useMemo(() => {
    if (!result) return "";
    const bars = new Map<number, string[]>();
    for (const item of result.chords) {
      const values = bars.get(item.bar) ?? [];
      if (values.at(-1) !== item.chord) values.push(item.chord);
      bars.set(item.bar, values);
    }
    const body = [...bars.values()].map((items) => `| ${items.join(" ")} `).join("") + "|";
    return `{title: ${sourceName}}\n{key: ${result.key}}\n{tempo: ${Math.round(result.tempo)}}\n{time: ${result.timeSignature}}\n\n${body}`;
  }, [result, sourceName]);

  function selectFile(next: File | null) {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setFile(next);
    setSourceName(next?.name ?? "Unknown");
    setAudioUrl(next ? URL.createObjectURL(next) : "");
    setResult(null);
    setPeaks([]);
    setCurrentTime(0);
    setStatus(next ? `${next.name} を選択しました` : "音源を選択してください");
  }

  async function analyze() {
    if (!file || busy) return;
    setBusy(true);
    setResult(null);
    setStatus("音声をデコード中…");
    try {
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const mono = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel);
        for (let index = 0; index < mono.length; index += 1) mono[index] += data[index] / decoded.numberOfChannels;
      }
      await context.close();
      const nextPeaks = buildPeaks(mono);
      setPeaks(nextPeaks);
      setStatus("拍子・コード・無音区間をWASMで解析中…");
      const worker = new Worker(new URL("./audio/analysis-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === "result") {
          setResult(markNoChord(event.data.result, nextPeaks));
          setStatus("解析完了。N区間・波形・候補を確認できます");
        } else {
          setStatus(`解析失敗: ${event.data.message}`);
        }
        setBusy(false);
        worker.terminate();
      };
      worker.onerror = (event) => {
        setStatus(`Workerエラー: ${event.message}`);
        setBusy(false);
        worker.terminate();
      };
      worker.postMessage({ samples: mono, sampleRate: decoded.sampleRate }, [mono.buffer]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "解析に失敗しました");
      setBusy(false);
    }
  }

  function seekTo(seconds: number) {
    const value = Math.max(0, Math.min(seconds, result?.duration ?? seconds));
    if (audioRef.current) audioRef.current.currentTime = value;
    setCurrentTime(value);
  }

  function editChord(index: number, chord: string) {
    setResult((previous) => previous ? {
      ...previous,
      chords: previous.chords.map((item, itemIndex) => itemIndex === index ? { ...item, chord } : item),
    } : previous);
  }

  async function copyChordPro() {
    await navigator.clipboard.writeText(chordPro);
    setStatus("ChordProをコピーしました");
  }

  function downloadProject() {
    if (!result) return;
    const project: AnalysisProject = { format: "mfs-analysis", version: 1, sourceName, savedAt: new Date().toISOString(), result };
    const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sourceName.replace(/\.[^.]+$/, "") || "analysis"}.mfs.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("解析JSONを保存しました");
  }

  async function loadProject(next: File | null) {
    if (!next) return;
    try {
      const project = JSON.parse(await next.text()) as AnalysisProject;
      if (project.format !== "mfs-analysis" || project.version !== 1 || !project.result?.chords) throw new Error("MFS解析JSONではありません");
      setResult(project.result);
      setSourceName(project.sourceName || next.name);
      setCurrentTime(0);
      setStatus("解析JSONを読み込みました。音源を選び直すと再生もできます");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "JSONを読み込めませんでした");
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">MFS / Music From Sound</p>
        <h1>音源を、ブラウザだけでコード譜へ。</h1>
        <p className="lead">音源は送信せず、拍子・ダウンビート・低音・コード遷移を端末内のRust/WASMで解析します。</p>
      </section>

      <section className="panel upload" onClick={() => inputRef.current?.click()}>
        <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" hidden onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
        <strong>{file ? file.name : "音声ファイルを選択"}</strong>
        <span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "MP3 / WAV / M4A / OGG など"}</span>
      </section>

      {audioUrl && <audio className="player" ref={audioRef} src={audioUrl} controls onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} />}
      {peaks.length > 0 && result && <Waveform peaks={peaks} duration={result.duration} currentTime={currentTime} onSeek={seekTo} />}

      <div className="actions">
        <button disabled={!file || busy} onClick={analyze}>{busy ? "解析中…" : "耳コピ開始"}</button>
        <button className="secondary" onClick={() => projectInputRef.current?.click()}>解析JSONを開く</button>
        <input ref={projectInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void loadProject(event.target.files?.[0] ?? null)} />
        <span className="status">{status}</span>
      </div>

      {result && (
        <section className="results">
          <div className="metrics">
            <article><span>BPM</span><strong>{Math.round(result.tempo)}</strong></article>
            <article><span>Key</span><strong>{result.key}</strong></article>
            <article><span>拍子</span><strong>{result.timeSignature}</strong><small>{Math.round(result.meterConfidence * 100)}%</small></article>
            <article><span>小節頭</span><strong>{result.beatOffset.toFixed(2)} sec</strong></article>
          </div>

          <div className="panel">
            <div className="panelTitle"><h2>小節・拍同期タイムライン</h2><span>{result.chords.length} frames / N・オンコード対応</span></div>
            <div className="timeline">
              {result.chords.map((item, index) => (
                <div className={`chord ${activeChordIndex === index ? "active" : ""} ${item.beat === 1 ? "barStart" : ""} ${item.chord === "N" ? "noChord" : ""}`} key={`${item.start}-${index}`} onClick={() => seekTo(item.start)}>
                  <div className="position"><b>{item.bar}</b><span>{item.beat}/{result.beatsPerBar}</span></div>
                  <input value={item.chord} onClick={(event) => event.stopPropagation()} onChange={(event) => editChord(index, event.target.value)} />
                  <div className="candidates" onClick={(event) => event.stopPropagation()}>
                    {[{ chord: "N", confidence: 1 }, ...item.candidates.filter((candidate) => candidate.chord !== "N")].slice(0, 4).map((candidate) => (
                      <button key={candidate.chord} className={candidate.chord === item.chord ? "selected" : ""} onClick={() => editChord(index, candidate.chord)}>{candidate.chord}</button>
                    ))}
                  </div>
                  <span>{formatTime(item.start)}–{formatTime(item.end)}</span>
                  <small>{Math.round(item.confidence * 100)}%</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panelTitle"><h2>ChordPro</h2><div className="panelButtons"><button className="secondary" onClick={downloadProject}>JSON保存</button><button className="secondary" onClick={copyChordPro}>コピー</button></div></div>
            <pre>{chordPro}</pre>
          </div>
        </section>
      )}
    </main>
  );
}
