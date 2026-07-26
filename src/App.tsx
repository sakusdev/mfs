import { useMemo, useRef, useState } from "react";

type AnalysisResult = {
  duration: number;
  sampleRate: number;
  tempo: number;
  key: string;
  chords: Array<{ start: number; end: number; chord: string; confidence: number }>;
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
  const [status, setStatus] = useState("音源を選択してください");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const chordPro = useMemo(() => {
    if (!result) return "";
    const bars = result.chords.map((item) => item.chord).join(" | ");
    return `{title: ${file?.name ?? "Unknown"}}\n{key: ${result.key}}\n{tempo: ${Math.round(result.tempo)}}\n\n| ${bars} |`;
  }, [file, result]);

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

      setStatus("WASMで解析中…");
      const worker = new Worker(new URL("./audio/analysis-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === "result") {
          setResult(event.data.result);
          setStatus("解析完了");
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

  async function copyChordPro() {
    await navigator.clipboard.writeText(chordPro);
    setStatus("ChordProをコピーしました");
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">MFS / Music From Sound</p>
        <h1>音源を、ブラウザだけでコード譜へ。</h1>
        <p className="lead">ファイルはCloudflareへ送信せず、音声解析は端末内のWeb Worker + Rust/WASMで実行します。</p>
      </section>

      <section className="panel upload" onClick={() => inputRef.current?.click()}>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
          hidden
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            setFile(next);
            setResult(null);
            setStatus(next ? `${next.name} を選択しました` : "音源を選択してください");
          }}
        />
        <strong>{file ? file.name : "音声ファイルを選択"}</strong>
        <span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "MP3 / WAV / M4A / OGG など"}</span>
      </section>

      <div className="actions">
        <button disabled={!file || busy} onClick={analyze}>{busy ? "解析中…" : "耳コピ開始"}</button>
        <span className="status">{status}</span>
      </div>

      {result && (
        <section className="results">
          <div className="metrics">
            <article><span>BPM</span><strong>{Math.round(result.tempo)}</strong></article>
            <article><span>Key</span><strong>{result.key}</strong></article>
            <article><span>Duration</span><strong>{formatTime(result.duration)}</strong></article>
            <article><span>Rate</span><strong>{result.sampleRate} Hz</strong></article>
          </div>

          <div className="panel">
            <div className="panelTitle"><h2>コード候補</h2><span>暫定解析</span></div>
            <div className="chords">
              {result.chords.map((item, index) => (
                <div className="chord" key={`${item.start}-${index}`}>
                  <strong>{item.chord}</strong>
                  <span>{formatTime(item.start)}</span>
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
