/// <reference lib="webworker" />

import initChord, { analyze_audio } from "../wasm/pkg/mfs_core";
import initMelody, { analyze_melody } from "../wasm/melody-pkg/melody_core";
import { postprocessAnalysis, type AnalysisResult } from "./postprocess";

type Input = { samples: Float32Array; sampleRate: number };

self.onmessage = async (event: MessageEvent<Input>) => {
  try {
    await Promise.all([initChord(), initMelody()]);
    const chordJson = analyze_audio(event.data.samples, event.data.sampleRate);
    const melodyJson = analyze_melody(event.data.samples, event.data.sampleRate);
    const chords = JSON.parse(chordJson) as AnalysisResult;
    const melody = JSON.parse(melodyJson) as AnalysisResult["melody"];
    const result = postprocessAnalysis({ ...chords, melody: melody ?? [] });
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
