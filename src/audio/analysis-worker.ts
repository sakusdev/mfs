/// <reference lib="webworker" />

import init, { analyze_audio } from "../wasm/pkg/mfs_core";

type Input = { samples: Float32Array; sampleRate: number };

self.onmessage = async (event: MessageEvent<Input>) => {
  try {
    await init();
    const json = analyze_audio(event.data.samples, event.data.sampleRate);
    self.postMessage({ type: "result", result: JSON.parse(json) });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
