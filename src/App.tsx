import { useEffect, useMemo, useRef, useState } from "react";

type ChordSegment = { start: number; end: number; chord: string; confidence: number };
type AnalysisResult = {
  duration: number;
  sampleRate: number;
  tempo: number;
  key: string;
  beatDuration: number;
  chords: ChordSegment[];
};

type WorkerResponse =
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; message: string };

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [status, setStatus] = useState("音源を選択してください");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
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
    const bars = result.chords.map((item) => item.chord).join(" | ");
    return `{title: ${file?.name ?? "Unknown"}}\n{key: ${result.key}}\n{tempo: ${Math.round(result.tempo)}}\n\n| ${bars} |`;
  }, [file, result]);

  function selectFile(next: File | null) {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setFile(next);
    setAudioUrl(next ? URL.createObjectURL(next) : "");
    setResult(null);
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
        for (let i = 0; i < mono.length; i += 1) mono[i] += data[i] / decoded.numberOfChannels;
      }
      await context.close();
      setStatus("拍・低音・コード遷移をWASMで解析中…");
      const worker = new Worker(new URL("./audio/analysis-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === "result") {
          setResult(event.data.result);
          setStatus("解析完了。コードをクリックすると再生位置が移動します");
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
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
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

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">MFS / Music From Sound</p>
        <h1>音源を、ブラウザだけでコード譜へ。</h1>
        <p className="lead">ファイルはCloudflareへ送信せず、拍同期・低域解析・時系列補正を端末内のWeb Worker + Rust/WASMで実行します。</p>
      </section>

      <section className="panel upload" onClick={() => inputRef.current?.click()}>
        <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" hidden onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
        <strong>{file ? file.name : "音声ファイルを選択"}</strong>
        <span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "MP3 / WAV / M4A / OGG など"}</span>
      </section>

      {audioUrl && <audio className="player" ref={audioRef} src={audioUrl} controls onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} />}

      <div className="actions">
        <button disabled={!file || busy} onClick={analyze}>{busy ? "解析中…" : "耳コピ開始"}</button>
        <span className="status">{status}</span>
      </div>

      {result && (
        <section className="results">
          <div className="metrics">
            <article><span>BPM</span><strong>{Math.round(result.tempo)}</strong></article>
            <article><span>Key</span><strong>{result.key}</strong></article>
            <article><span>Beat</span><strong>{result.beatDuration.toFixed(2)} sec</strong></article>
            <article><span>Duration</span><strong>{formatTime(result.duration)}</strong></article>
          </div>

          <div className="panel">
            <div className="panelTitle"><h2>再生連動コードタイムライン</h2><span>{result.chords.length} segments</span></div>
            <div className="timeline">
              {result.chords.map((item, index) => (
                <div className={`chord ${activeChordIndex === index ? "active" : ""}`} key={`${item.start}-${index}`} onClick={() => seekTo(item.start)}>
                  <input value={item.chord} onClick={(event) => event.stopPropagation()} onChange={(event) => editChord(index, event.target.value)} />
                  <span>{formatTime(item.start)}–{formatTime(item.end)}</span>
                  <small>{Math.round(item.confidence * 100)}%</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panelTitle"><h2>ChordPro</h2><button className="secondary" onClick={copyChordPro}>コピー</button></div>
            <pre>{chordPro}</pre>
          </div>
        </section>
      )}
    </main>
  );
}
