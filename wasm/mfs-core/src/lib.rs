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

#[derive(Clone)]
struct FrameFeatures {
    chroma: [f32; 12],
    bass: [f32; 12],
    energy: f32,
    flatness: f32,
    tonalness: f32,
}

#[derive(Clone, Serialize)]
struct ChordCandidate {
    chord: String,
    confidence: f32,
}

#[derive(Serialize)]
struct ChordSegment {
    start: f32,
    end: f32,
    chord: String,
    confidence: f32,
    candidates: Vec<ChordCandidate>,
    bar: usize,
    beat: usize,
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
    #[serde(rename = "beatOffset")]
    beat_offset: f32,
    #[serde(rename = "beatsPerBar")]
    beats_per_bar: usize,
    #[serde(rename = "beatUnit")]
    beat_unit: usize,
    #[serde(rename = "timeSignature")]
    time_signature: String,
    #[serde(rename = "meterConfidence")]
    meter_confidence: f32,
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

fn frame_features(frame: &[f32], sample_rate: u32) -> FrameFeatures {
    let size = frame.len().next_power_of_two().max(2048);
    let mut buffer = vec![Complex::new(0.0_f32, 0.0_f32); size];
    let mut energy = 0.0;
    for (index, sample) in frame.iter().enumerate() {
        let window = 0.5
            - 0.5
                * ((2.0 * std::f32::consts::PI * index as f32)
                    / frame.len().max(1) as f32)
                    .cos();
        buffer[index].re = sample * window;
        energy += sample * sample;
    }

    let mut planner = FftPlanner::<f32>::new();
    planner.plan_fft_forward(size).process(&mut buffer);

    let mut chroma = [0.0_f32; 12];
    let mut bass = [0.0_f32; 12];
    let mut magnitude_sum = 0.0;
    let mut log_sum = 0.0;
    let mut bin_count = 0usize;

    for (bin, value) in buffer.iter().take(size / 2).enumerate().skip(1) {
        let frequency = bin as f32 * sample_rate as f32 / size as f32;
        if !(45.0..=5000.0).contains(&frequency) {
            continue;
        }
        let magnitude = value.norm().sqrt().max(1e-12);
        magnitude_sum += magnitude;
        log_sum += magnitude.ln();
        bin_count += 1;

        let midi = 69.0 + 12.0 * (frequency / 440.0).log2();
        let pitch_class = ((midi.round() as i32 % 12) + 12) % 12;
        chroma[pitch_class as usize] += magnitude;
        if frequency <= 260.0 {
            bass[pitch_class as usize] += magnitude * (260.0 / frequency.max(45.0)).sqrt();
        }
    }

    normalize(&mut chroma);
    normalize(&mut bass);
    let arithmetic = magnitude_sum / bin_count.max(1) as f32;
    let geometric = (log_sum / bin_count.max(1) as f32).exp();
    let flatness = if arithmetic > 1e-9 {
        (geometric / arithmetic).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let tonalness = chroma.iter().copied().fold(0.0_f32, f32::max);

    FrameFeatures {
        chroma,
        bass,
        energy: (energy / frame.len().max(1) as f32).sqrt(),
        flatness,
        tonalness,
    }
}

fn emission_score(feature: &FrameFeatures, template: &ChordTemplate) -> f32 {
    if feature.energy < 0.0015 {
        return -3.0;
    }
    let active = template.tones.iter().filter(|value| **value > 0.0).count() as f32;
    let inside: f32 = feature
        .chroma
        .iter()
        .zip(template.tones)
        .map(|(chroma, tone)| chroma * tone)
        .sum::<f32>()
        / active.max(1.0);
    let outside: f32 = feature
        .chroma
        .iter()
        .zip(template.tones)
        .map(|(chroma, tone)| chroma * (1.0 - tone))
        .sum::<f32>()
        / (12.0 - active).max(1.0);
    inside * 4.2 - outside * 1.6
        + feature.bass[template.root] * 0.8
        + feature.bass[(template.root + 7) % 12] * 0.15
        + feature.tonalness * 0.25
        - feature.flatness * 0.2
}

fn transition_score(previous: &ChordTemplate, current: &ChordTemplate) -> f32 {
    if previous.name == current.name {
        return 0.48;
    }
    let root_distance = (12 + current.root as i32 - previous.root as i32) % 12;
    let common = previous
        .tones
        .iter()
        .zip(current.tones)
        .filter(|(left, right)| **left > 0.0 && *right > 0.0)
        .count() as f32;
    let motion = match root_distance {
        5 | 7 => 0.14,
        2 | 10 => 0.07,
        _ => 0.0,
    };
    common * 0.025 + motion - 0.18
}

fn estimate_tempo(samples: &[f32], sample_rate: u32) -> (f32, Vec<f32>) {
    let hop = (sample_rate as usize / 100).max(1);
    let envelope: Vec<f32> = samples
        .chunks(hop)
        .map(|chunk| chunk.iter().map(|value| value.abs()).sum::<f32>() / chunk.len().max(1) as f32)
        .collect();
    let onset: Vec<f32> = envelope
        .windows(2)
        .map(|window| (window[1] - window[0]).max(0.0))
        .collect();
    if onset.len() < 200 {
        return (120.0, onset);
    }
    let mut best = (120.0, f32::MIN);
    for bpm in 60..=190 {
        let lag = ((60.0 / bpm as f32) * 100.0).round() as usize;
        if lag == 0 || lag >= onset.len() {
            continue;
        }
        let score: f32 = onset.iter().skip(lag).zip(onset.iter()).map(|(a, b)| a * b).sum();
        let harmonic = if lag * 2 < onset.len() {
            onset
                .iter()
                .skip(lag * 2)
                .zip(onset.iter())
                .map(|(a, b)| a * b)
                .sum::<f32>()
                * 0.3
        } else {
            0.0
        };
        if score + harmonic > best.1 {
            best = (bpm as f32, score + harmonic);
        }
    }
    (best.0, onset)
}

fn estimate_beat_phase(onset: &[f32], tempo: f32) -> (usize, usize) {
    let period = ((60.0 / tempo.max(1.0)) * 100.0).round().max(1.0) as usize;
    let mut best = (0usize, f32::MIN);
    for phase in 0..period {
        let mut score = 0.0;
        let mut index = phase;
        while index < onset.len() {
            score += onset[index];
            index += period;
        }
        if score > best.1 {
            best = (phase, score);
        }
    }
    (best.0, period)
}

fn beat_strengths(onset: &[f32], phase: usize, period: usize) -> Vec<f32> {
    let radius = (period / 8).max(1);
    let mut strengths = Vec::new();
    let mut center = phase;
    while center < onset.len() {
        let start = center.saturating_sub(radius);
        let end = (center + radius + 1).min(onset.len());
        strengths.push(onset[start..end].iter().sum());
        center += period;
    }
    strengths
}

fn estimate_meter(strengths: &[f32]) -> (usize, usize, usize, f32) {
    let candidates = [(3usize, 4usize), (4, 4), (6, 8)];
    let mut ranked = Vec::new();
    for (beats, unit) in candidates {
        let mut best_phase = 0usize;
        let mut best_score = f32::MIN;
        for phase in 0..beats {
            let mut down = 0.0;
            let mut other = 0.0;
            let mut down_count = 0usize;
            let mut other_count = 0usize;
            for (index, value) in strengths.iter().enumerate() {
                if index % beats == phase {
                    down += *value;
                    down_count += 1;
                } else {
                    other += *value;
                    other_count += 1;
                }
            }
            let down_mean = down / down_count.max(1) as f32;
            let other_mean = other / other_count.max(1) as f32;
            let mut score = down_mean - other_mean * 0.7;
            if beats == 6 {
                let secondary_phase = (phase + 3) % 6;
                let secondary: Vec<f32> = strengths
                    .iter()
                    .enumerate()
                    .filter_map(|(index, value)| (index % 6 == secondary_phase).then_some(*value))
                    .collect();
                score += secondary.iter().sum::<f32>() / secondary.len().max(1) as f32 * 0.2;
            }
            if score > best_score {
                best_score = score;
                best_phase = phase;
            }
        }
        ranked.push((beats, unit, best_phase, best_score));
    }
    ranked.sort_by(|a, b| b.3.total_cmp(&a.3));
    let best = ranked[0];
    let second = ranked.get(1).copied().unwrap_or(best);
    let scale = best.3.abs().max(second.3.abs()).max(1e-6);
    let confidence = (0.5 + (best.3 - second.3) / scale * 0.35).clamp(0.05, 0.98);
    (best.0, best.1, best.2, confidence)
}

fn estimate_key(chroma: &[f32; 12]) -> String {
    let major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    let minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    let mut best = (0usize, true, f32::MIN);
    for root in 0..12 {
        for (is_major, profile) in [(true, major), (false, minor)] {
            let score: f32 = (0..12).map(|index| chroma[(index + root) % 12] * profile[index]).sum();
            if score > best.2 {
                best = (root, is_major, score);
            }
        }
    }
    format!("{} {}", NOTE_NAMES[best.0], if best.1 { "major" } else { "minor" })
}

fn chord_name_with_bass(template: &ChordTemplate, bass: &[f32; 12]) -> String {
    let (bass_note, strength) = bass
        .iter()
        .copied()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap_or((template.root, 0.0));
    if strength >= 0.24 && bass_note != template.root && template.tones[bass_note] > 0.0 {
        format!("{}/{}", template.name, NOTE_NAMES[bass_note])
    } else {
        template.name.clone()
    }
}

fn top_candidates(scores: &[f32], templates: &[ChordTemplate], feature: &FrameFeatures) -> Vec<ChordCandidate> {
    let mut ranked: Vec<(usize, f32)> = scores.iter().copied().enumerate().collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let maximum = ranked.first().map(|value| value.1).unwrap_or(0.0);
    ranked
        .into_iter()
        .take(3)
        .map(|(index, score)| ChordCandidate {
            chord: chord_name_with_bass(&templates[index], &feature.bass),
            confidence: (0.5 + (score - maximum) * 0.25).clamp(0.05, 0.99),
        })
        .collect()
}

fn is_no_chord(feature: &FrameFeatures, emissions: &[f32]) -> bool {
    if feature.energy < 0.0022 {
        return true;
    }
    let mut ranked = emissions.to_vec();
    ranked.sort_by(|a, b| b.total_cmp(a));
    let best = ranked.first().copied().unwrap_or(-3.0);
    let second = ranked.get(1).copied().unwrap_or(best);
    let ambiguous = best - second < 0.018;
    let percussive = feature.flatness > 0.48 && feature.tonalness < 0.17;
    let weak_tonal = feature.tonalness < 0.125 && best < 0.35;
    percussive || weak_tonal || (ambiguous && feature.flatness > 0.38 && best < 0.28)
}

#[wasm_bindgen]
pub fn analyze_audio(samples: &[f32], sample_rate: u32) -> String {
    let duration = samples.len() as f32 / sample_rate.max(1) as f32;
    let (tempo, onset) = estimate_tempo(samples, sample_rate);
    let beat_duration = 60.0 / tempo.max(1.0);
    let (beat_phase, beat_period) = estimate_beat_phase(&onset, tempo);
    let strengths = beat_strengths(&onset, beat_phase, beat_period);
    let (beats_per_bar, beat_unit, downbeat_phase, meter_confidence) = estimate_meter(&strengths);
    let beat_offset = ((beat_phase as f32 / 100.0) + downbeat_phase as f32 * beat_duration).min(duration);
    let analysis_step = (beat_duration / 2.0).clamp(0.18, 0.75);
    let segment_samples = (sample_rate as f32 * analysis_step).round().max(2048.0) as usize;
    let offset_samples = (beat_offset * sample_rate as f32) as usize;
    let templates = chord_templates();
    let mut global_chroma = [0.0_f32; 12];
    let mut features = Vec::new();

    for segment in samples.get(offset_samples..).unwrap_or(&[]).chunks(segment_samples) {
        if segment.len() < 1024 {
            break;
        }
        let feature = frame_features(segment, sample_rate);
        for index in 0..12 {
            global_chroma[index] += feature.chroma[index];
        }
        features.push(feature);
    }
    normalize(&mut global_chroma);

    let states = templates.len();
    let frames = features.len();
    let mut emissions = vec![vec![0.0_f32; states]; frames];
    for (frame, feature) in features.iter().enumerate() {
        for (state, template) in templates.iter().enumerate() {
            emissions[frame][state] = emission_score(feature, template);
        }
    }

    let mut previous = if frames > 0 { emissions[0].clone() } else { Vec::new() };
    let mut back = vec![vec![0usize; states]; frames];
    for frame in 1..frames {
        let mut next = vec![f32::NEG_INFINITY; states];
        for current in 0..states {
            let mut best = (0usize, f32::NEG_INFINITY);
            for prior in 0..states {
                let score = previous[prior] + transition_score(&templates[prior], &templates[current]);
                if score > best.1 {
                    best = (prior, score);
                }
            }
            next[current] = best.1 + emissions[frame][current];
            back[frame][current] = best.0;
        }
        previous = next;
    }

    let mut path = vec![0usize; frames];
    if frames > 0 {
        let mut state = previous
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|value| value.0)
            .unwrap_or(0);
        path[frames - 1] = state;
        for frame in (1..frames).rev() {
            state = back[frame][state];
            path[frame - 1] = state;
        }
    }

    let chords = path
        .into_iter()
        .enumerate()
        .map(|(index, state)| {
            let start = beat_offset + index as f32 * analysis_step;
            let beat_index = index / 2;
            let feature = &features[index];
            let no_chord = is_no_chord(feature, &emissions[index]);
            let selected_name = if no_chord {
                "N".to_string()
            } else {
                chord_name_with_bass(&templates[state], &feature.bass)
            };
            let mut alternatives = top_candidates(&emissions[index], &templates, feature);
            if no_chord {
                alternatives.insert(0, ChordCandidate { chord: "N".to_string(), confidence: 0.82 });
                alternatives.truncate(3);
            }
            let confidence = if no_chord {
                0.72
            } else {
                alternatives
                    .iter()
                    .find(|candidate| candidate.chord == selected_name)
                    .map(|candidate| candidate.confidence)
                    .unwrap_or(0.5)
            };
            ChordSegment {
                start,
                end: (start + analysis_step).min(duration),
                chord: selected_name,
                confidence,
                candidates: alternatives,
                bar: beat_index / beats_per_bar + 1,
                beat: beat_index % beats_per_bar + 1,
            }
        })
        .collect();

    let result = AnalysisResult {
        duration,
        sample_rate,
        tempo,
        key: estimate_key(&global_chroma),
        beat_duration,
        beat_offset,
        beats_per_bar,
        beat_unit,
        time_signature: format!("{}/{}", beats_per_bar, beat_unit),
        meter_confidence,
        chords,
    };
    serde_json::to_string(&result).unwrap_or_else(|_| "{\"error\":\"serialization failed\"}".to_string())
}
