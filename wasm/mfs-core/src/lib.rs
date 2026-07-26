use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use wasm_bindgen::prelude::*;

const NOTE_NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

#[derive(Serialize)]
struct ChordSegment {
    start: f32,
    end: f32,
    chord: String,
    confidence: f32,
}

#[derive(Serialize)]
struct AnalysisResult {
    duration: f32,
    #[serde(rename = "sampleRate")]
    sample_rate: u32,
    tempo: f32,
    key: String,
    chords: Vec<ChordSegment>,
}

fn chord_templates() -> Vec<(String, [f32; 12])> {
    let mut output = Vec::new();
    for root in 0..12 {
        for (suffix, intervals) in [("", vec![0, 4, 7]), ("m", vec![0, 3, 7]), ("7", vec![0, 4, 7, 10]), ("maj7", vec![0, 4, 7, 11]), ("m7", vec![0, 3, 7, 10])] {
            let mut template = [0.0; 12];
            for interval in intervals {
                template[(root + interval) % 12] = 1.0;
            }
            output.push((format!("{}{}", NOTE_NAMES[root], suffix), template));
        }
    }
    output
}

fn frame_chroma(frame: &[f32], sample_rate: u32) -> [f32; 12] {
    let size = frame.len().next_power_of_two();
    let mut buffer = vec![Complex::new(0.0_f32, 0.0_f32); size];
    for (i, sample) in frame.iter().enumerate() {
        let window = 0.5 - 0.5 * ((2.0 * std::f32::consts::PI * i as f32) / frame.len().max(1) as f32).cos();
        buffer[i].re = sample * window;
    }

    let mut planner = FftPlanner::<f32>::new();
    planner.plan_fft_forward(size).process(&mut buffer);

    let mut chroma = [0.0_f32; 12];
    for (bin, value) in buffer.iter().take(size / 2).enumerate().skip(1) {
        let frequency = bin as f32 * sample_rate as f32 / size as f32;
        if !(55.0..=5000.0).contains(&frequency) {
            continue;
        }
        let midi = 69.0 + 12.0 * (frequency / 440.0).log2();
        let pitch_class = ((midi.round() as i32 % 12) + 12) % 12;
        chroma[pitch_class as usize] += value.norm();
    }

    let sum: f32 = chroma.iter().sum();
    if sum > 0.0 {
        for value in &mut chroma {
            *value /= sum;
        }
    }
    chroma
}

fn best_chord(chroma: &[f32; 12], templates: &[(String, [f32; 12])]) -> (String, f32) {
    let mut best = ("N".to_string(), 0.0_f32);
    for (name, template) in templates {
        let active = template.iter().filter(|value| **value > 0.0).count() as f32;
        let inside: f32 = chroma.iter().zip(template).map(|(c, t)| c * t).sum::<f32>() / active.max(1.0);
        let outside: f32 = chroma.iter().zip(template).map(|(c, t)| c * (1.0 - t)).sum::<f32>() / (12.0 - active).max(1.0);
        let score = (inside - outside * 0.35).max(0.0);
        if score > best.1 {
            best = (name.clone(), score);
        }
    }
    let confidence = (best.1 * 5.0).clamp(0.05, 0.99);
    (best.0, confidence)
}

fn estimate_key(chroma: &[f32; 12]) -> String {
    let major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    let minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    let mut best = (0_usize, true, f32::MIN);
    for root in 0..12 {
        for (is_major, profile) in [(true, major), (false, minor)] {
            let score: f32 = (0..12).map(|i| chroma[(i + root) % 12] * profile[i]).sum();
            if score > best.2 {
                best = (root, is_major, score);
            }
        }
    }
    format!("{} {}", NOTE_NAMES[best.0], if best.1 { "major" } else { "minor" })
}

fn estimate_tempo(samples: &[f32], sample_rate: u32) -> f32 {
    let hop = (sample_rate as usize / 100).max(1);
    let mut envelope = Vec::new();
    for chunk in samples.chunks(hop) {
        envelope.push(chunk.iter().map(|v| v.abs()).sum::<f32>() / chunk.len().max(1) as f32);
    }
    let mean = envelope.iter().sum::<f32>() / envelope.len().max(1) as f32;
    let onset: Vec<f32> = envelope.windows(2).map(|w| (w[1] - w[0] - mean * 0.02).max(0.0)).collect();
    let mut best_bpm = 120.0;
    let mut best_score = f32::MIN;
    for bpm in 60..=190 {
        let lag = ((60.0 / bpm as f32) * 100.0).round() as usize;
        if lag == 0 || lag >= onset.len() { continue; }
        let score: f32 = onset.iter().skip(lag).zip(onset.iter()).map(|(a, b)| a * b).sum();
        if score > best_score {
            best_score = score;
            best_bpm = bpm as f32;
        }
    }
    best_bpm
}

#[wasm_bindgen]
pub fn analyze_audio(samples: &[f32], sample_rate: u32) -> String {
    let duration = samples.len() as f32 / sample_rate.max(1) as f32;
    let segment_samples = (sample_rate as usize * 2).max(2048);
    let templates = chord_templates();
    let mut global_chroma = [0.0_f32; 12];
    let mut chords = Vec::new();

    for (index, segment) in samples.chunks(segment_samples).enumerate() {
        if segment.len() < 1024 { break; }
        let chroma = frame_chroma(segment, sample_rate);
        for i in 0..12 { global_chroma[i] += chroma[i]; }
        let (chord, confidence) = best_chord(&chroma, &templates);
        let start = index as f32 * 2.0;
        chords.push(ChordSegment { start, end: (start + 2.0).min(duration), chord, confidence });
    }

    let total: f32 = global_chroma.iter().sum();
    if total > 0.0 {
        for value in &mut global_chroma { *value /= total; }
    }

    let result = AnalysisResult {
        duration,
        sample_rate,
        tempo: estimate_tempo(samples, sample_rate),
        key: estimate_key(&global_chroma),
        chords,
    };

    serde_json::to_string(&result).unwrap_or_else(|_| "{\"error\":\"serialization failed\"}".to_string())
}
