use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use wasm_bindgen::prelude::*;

const NOTE_NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

#[derive(Clone)]
struct ChordTemplate {
    name: String,
    root: usize,
    tones: [f32; 12],
}

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
    #[serde(rename = "beatDuration")]
    beat_duration: f32,
    chords: Vec<ChordSegment>,
}

fn chord_templates() -> Vec<ChordTemplate> {
    let qualities: [(&str, &[usize]); 7] = [
        ("", &[0, 4, 7]),
        ("m", &[0, 3, 7]),
        ("7", &[0, 4, 7, 10]),
        ("maj7", &[0, 4, 7, 11]),
        ("m7", &[0, 3, 7, 10]),
        ("sus4", &[0, 5, 7]),
        ("dim", &[0, 3, 6]),
    ];
    let mut output = Vec::new();
    for root in 0..12 {
        for (suffix, intervals) in qualities {
            let mut tones = [0.0; 12];
            for interval in intervals {
                tones[(root + interval) % 12] = 1.0;
            }
            output.push(ChordTemplate {
                name: format!("{}{}", NOTE_NAMES[root], suffix),
                root,
                tones,
            });
        }
    }
    output
}

fn normalize(values: &mut [f32; 12]) {
    let sum: f32 = values.iter().sum();
    if sum > 1e-9 {
        for value in values {
            *value /= sum;
        }
    }
}

fn frame_features(frame: &[f32], sample_rate: u32) -> ([f32; 12], [f32; 12], f32) {
    let size = frame.len().next_power_of_two().max(2048);
    let mut buffer = vec![Complex::new(0.0_f32, 0.0_f32); size];
    let mut energy = 0.0;
    for (i, sample) in frame.iter().enumerate() {
        let window = 0.5 - 0.5 * ((2.0 * std::f32::consts::PI * i as f32) / frame.len().max(1) as f32).cos();
        buffer[i].re = sample * window;
        energy += sample * sample;
    }

    let mut planner = FftPlanner::<f32>::new();
    planner.plan_fft_forward(size).process(&mut buffer);

    let mut chroma = [0.0_f32; 12];
    let mut bass = [0.0_f32; 12];
    for (bin, value) in buffer.iter().take(size / 2).enumerate().skip(1) {
        let frequency = bin as f32 * sample_rate as f32 / size as f32;
        if !(45.0..=5000.0).contains(&frequency) {
            continue;
        }
        let midi = 69.0 + 12.0 * (frequency / 440.0).log2();
        let pitch_class = ((midi.round() as i32 % 12) + 12) % 12;
        let magnitude = value.norm().sqrt();
        chroma[pitch_class as usize] += magnitude;
        if frequency <= 260.0 {
            bass[pitch_class as usize] += magnitude * (260.0 / frequency.max(45.0)).sqrt();
        }
    }
    normalize(&mut chroma);
    normalize(&mut bass);
    (chroma, bass, (energy / frame.len().max(1) as f32).sqrt())
}

fn emission_score(chroma: &[f32; 12], bass: &[f32; 12], template: &ChordTemplate, energy: f32) -> f32 {
    if energy < 0.002 {
        return -2.0;
    }
    let active = template.tones.iter().filter(|value| **value > 0.0).count() as f32;
    let inside: f32 = chroma.iter().zip(template.tones).map(|(c, t)| c * t).sum::<f32>() / active.max(1.0);
    let outside: f32 = chroma.iter().zip(template.tones).map(|(c, t)| c * (1.0 - t)).sum::<f32>() / (12.0 - active).max(1.0);
    let root_bonus = bass[template.root] * 0.75;
    let fifth_bonus = bass[(template.root + 7) % 12] * 0.15;
    inside * 4.0 - outside * 1.5 + root_bonus + fifth_bonus
}

fn transition_score(previous: &ChordTemplate, current: &ChordTemplate) -> f32 {
    if previous.name == current.name {
        return 0.45;
    }
    let root_distance = (12 + current.root as i32 - previous.root as i32) % 12;
    let common: f32 = previous
        .tones
        .iter()
        .zip(current.tones)
        .filter(|(a, b)| **a > 0.0 && *b > 0.0)
        .count() as f32;
    let musical_motion = match root_distance {
        5 | 7 => 0.12,
        2 | 10 => 0.06,
        _ => 0.0,
    };
    common * 0.025 + musical_motion - 0.18
}

fn viterbi_decode(features: &[([f32; 12], [f32; 12], f32)], templates: &[ChordTemplate]) -> Vec<(usize, f32)> {
    if features.is_empty() || templates.is_empty() {
        return Vec::new();
    }
    let states = templates.len();
    let frames = features.len();
    let mut previous = vec![f32::NEG_INFINITY; states];
    let mut back = vec![vec![0_usize; states]; frames];
    let mut emissions = vec![vec![0.0_f32; states]; frames];

    for (t, (chroma, bass, energy)) in features.iter().enumerate() {
        for (s, template) in templates.iter().enumerate() {
            emissions[t][s] = emission_score(chroma, bass, template, *energy);
        }
    }
    previous.clone_from_slice(&emissions[0]);

    for t in 1..frames {
        let mut next = vec![f32::NEG_INFINITY; states];
        for current in 0..states {
            let mut best = (0_usize, f32::NEG_INFINITY);
            for prev in 0..states {
                let score = previous[prev] + transition_score(&templates[prev], &templates[current]);
                if score > best.1 {
                    best = (prev, score);
                }
            }
            next[current] = best.1 + emissions[t][current];
            back[t][current] = best.0;
        }
        previous = next;
    }

    let mut state = previous
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(index, _)| index)
        .unwrap_or(0);
    let mut path = vec![0_usize; frames];
    path[frames - 1] = state;
    for t in (1..frames).rev() {
        state = back[t][state];
        path[t - 1] = state;
    }

    path.into_iter()
        .enumerate()
        .map(|(t, selected)| {
            let selected_score = emissions[t][selected];
            let mut alternatives = emissions[t].clone();
            alternatives.sort_by(|a, b| b.total_cmp(a));
            let margin = selected_score - alternatives.get(1).copied().unwrap_or(selected_score - 0.1);
            let confidence = (0.52 + margin * 0.32).clamp(0.08, 0.98);
            (selected, confidence)
        })
        .collect()
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
    let envelope: Vec<f32> = samples
        .chunks(hop)
        .map(|chunk| chunk.iter().map(|v| v.abs()).sum::<f32>() / chunk.len().max(1) as f32)
        .collect();
    if envelope.len() < 200 {
        return 120.0;
    }
    let onset: Vec<f32> = envelope.windows(2).map(|w| (w[1] - w[0]).max(0.0)).collect();
    let mut best_bpm = 120.0;
    let mut best_score = f32::MIN;
    for bpm in 60..=190 {
        let lag = ((60.0 / bpm as f32) * 100.0).round() as usize;
        if lag == 0 || lag >= onset.len() {
            continue;
        }
        let score: f32 = onset.iter().skip(lag).zip(onset.iter()).map(|(a, b)| a * b).sum();
        let harmonic_lag = lag * 2;
        let harmonic = if harmonic_lag < onset.len() {
            onset.iter().skip(harmonic_lag).zip(onset.iter()).map(|(a, b)| a * b).sum::<f32>() * 0.35
        } else {
            0.0
        };
        if score + harmonic > best_score {
            best_score = score + harmonic;
            best_bpm = bpm as f32;
        }
    }
    best_bpm
}

fn merge_segments(raw: Vec<ChordSegment>) -> Vec<ChordSegment> {
    let mut merged: Vec<ChordSegment> = Vec::new();
    for item in raw {
        if let Some(last) = merged.last_mut() {
            if last.chord == item.chord && (last.end - item.start).abs() < 0.02 {
                let previous_duration = last.end - last.start;
                let item_duration = item.end - item.start;
                last.confidence = (last.confidence * previous_duration + item.confidence * item_duration)
                    / (previous_duration + item_duration).max(0.001);
                last.end = item.end;
                continue;
            }
        }
        merged.push(item);
    }
    merged
}

#[wasm_bindgen]
pub fn analyze_audio(samples: &[f32], sample_rate: u32) -> String {
    let duration = samples.len() as f32 / sample_rate.max(1) as f32;
    let tempo = estimate_tempo(samples, sample_rate);
    let beat_duration = 60.0 / tempo.max(1.0);
    let analysis_step = (beat_duration / 2.0).clamp(0.18, 0.75);
    let segment_samples = (sample_rate as f32 * analysis_step).round().max(2048.0) as usize;
    let templates = chord_templates();
    let mut global_chroma = [0.0_f32; 12];
    let mut features = Vec::new();

    for segment in samples.chunks(segment_samples) {
        if segment.len() < 1024 {
            break;
        }
        let feature = frame_features(segment, sample_rate);
        for i in 0..12 {
            global_chroma[i] += feature.0[i];
        }
        features.push(feature);
    }
    normalize(&mut global_chroma);

    let decoded = viterbi_decode(&features, &templates);
    let raw: Vec<ChordSegment> = decoded
        .into_iter()
        .enumerate()
        .map(|(index, (state, confidence))| {
            let start = index as f32 * analysis_step;
            ChordSegment {
                start,
                end: (start + analysis_step).min(duration),
                chord: templates[state].name.clone(),
                confidence,
            }
        })
        .collect();

    let result = AnalysisResult {
        duration,
        sample_rate,
        tempo,
        key: estimate_key(&global_chroma),
        beat_duration,
        chords: merge_segments(raw),
    };

    serde_json::to_string(&result).unwrap_or_else(|_| "{\"error\":\"serialization failed\"}".to_string())
}
