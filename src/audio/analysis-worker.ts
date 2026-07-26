/// <reference lib="webworker" />

import initChord, { analyze_audio } from "../wasm/pkg/mfs_core";
import initMelody, { analyze_melody } from "../wasm/melody-pkg/melody_core";

type Input = { samples: Float32Array; sampleRate: number };

self.onmessage = async (event: MessageEvent<Input>) => {
  try {
    await Promise.all([initChord(), initMelody()]);
    const chordJson = analyze_audio(event.data.samples, event.data.sampleRate);
    const melodyJson = analyze_melody(event.data.samples, event.data.sampleRate);
    const result = JSON.parse(chordJson);
    result.melody = JSON.parse(melodyJson);
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
