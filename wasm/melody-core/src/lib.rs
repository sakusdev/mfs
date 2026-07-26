use serde::Serialize;
use wasm_bindgen::prelude::*;

const NOTE_NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

#[derive(Clone)]
struct PitchFrame {
    time: f32,
    midi: f32,
    frequency: f32,
    confidence: f32,
    voiced: bool,
}

#[derive(Serialize)]
struct MelodyNote {
    start: f32,
    end: f32,
    midi: i32,
    note: String,
    frequency: f32,
    confidence: f32,
}

fn rms(frame: &[f32]) -> f32 {
    (frame.iter().map(|value| value * value).sum::<f32>() / frame.len().max(1) as f32).sqrt()
}

fn correlation_at(frame: &[f32], lag: usize) -> f32 {
    if lag == 0 || lag >= frame.len() {
        return 0.0;
    }
    let mut correlation = 0.0_f32;
    let mut left_energy = 0.0_f32;
    let mut right_energy = 0.0_f32;
    for index in 0..frame.len() - lag {
        let left = frame[index];
        let right = frame[index + lag];
        correlation += left * right;
        left_energy += left * left;
        right_energy += right * right;
    }
    correlation / (left_energy * right_energy).sqrt().max(1e-9)
}

fn estimate_pitch(frame: &[f32], sample_rate: u32) -> (f32, f32) {
    if frame.len() < 128 || rms(frame) < 0.003 {
        return (0.0, 0.0);
    }

    let decimation = (sample_rate / 11_025).max(1) as usize;
    let reduced: Vec<f32> = frame.iter().step_by(decimation).copied().collect();
    let reduced_rate = sample_rate as f32 / decimation as f32;
    let min_frequency = 75.0_f32;
    let max_frequency = 1400.0_f32;
    let min_lag = (reduced_rate / max_frequency).floor().max(2.0) as usize;
    let max_lag = (reduced_rate / min_frequency).ceil().min((reduced.len() / 2) as f32) as usize;
    if max_lag <= min_lag {
        return (0.0, 0.0);
    }

    let mut coarse_lag = 0usize;
    let mut best_score = 0.0_f32;
    for lag in (min_lag..=max_lag).step_by(2) {
        let score = correlation_at(&reduced, lag);
        if score > best_score {
            best_score = score;
            coarse_lag = lag;
        }
    }

    if coarse_lag == 0 {
        return (0.0, 0.0);
    }

    let refine_start = coarse_lag.saturating_sub(2).max(min_lag);
    let refine_end = (coarse_lag + 2).min(max_lag);
    let mut best_lag = coarse_lag;
    for lag in refine_start..=refine_end {
        let score = correlation_at(&reduced, lag);
        if score > best_score {
            best_score = score;
            best_lag = lag;
        }
    }

    if best_score < 0.42 {
        return (0.0, best_score.max(0.0));
    }

    let frequency = reduced_rate / best_lag as f32;
    (frequency, best_score.clamp(0.0, 1.0))
}

fn median(values: &mut [f32]) -> f32 {
    values.sort_by(|left, right| left.total_cmp(right));
    values[values.len() / 2]
}

fn smooth_frames(frames: &mut [PitchFrame]) {
    if frames.len() < 3 {
        return;
    }
    let original = frames.to_vec();
    for index in 1..frames.len() - 1 {
        let mut voiced: Vec<f32> = original[index - 1..=index + 1]
            .iter()
            .filter(|frame| frame.voiced)
            .map(|frame| frame.midi)
            .collect();
        if voiced.len() >= 2 {
            let value = median(&mut voiced);
            frames[index].midi = value;
            frames[index].frequency = 440.0 * 2.0_f32.powf((value - 69.0) / 12.0);
            frames[index].voiced = true;
        }
    }
}

fn note_name(midi: i32) -> String {
    let pitch_class = midi.rem_euclid(12) as usize;
    let octave = midi / 12 - 1;
    format!("{}{}", NOTE_NAMES[pitch_class], octave)
}

fn push_note(output: &mut Vec<MelodyNote>, frames: &[PitchFrame], start: usize, end: usize, midi: i32, hop_seconds: f32) {
    if end <= start {
        return;
    }
    let duration = (end - start) as f32 * hop_seconds;
    if duration < 0.08 {
        return;
    }
    let slice = &frames[start..end];
    let confidence = slice.iter().map(|frame| frame.confidence).sum::<f32>() / slice.len().max(1) as f32;
    let frequency = slice.iter().map(|frame| frame.frequency).sum::<f32>() / slice.len().max(1) as f32;
    output.push(MelodyNote {
        start: slice.first().map(|frame| frame.time).unwrap_or(0.0),
        end: slice.last().map(|frame| frame.time + hop_seconds).unwrap_or(0.0),
        midi,
        note: note_name(midi),
        frequency,
        confidence: confidence.clamp(0.0, 0.99),
    });
}

fn segment_notes(frames: &[PitchFrame], hop_seconds: f32) -> Vec<MelodyNote> {
    let mut output = Vec::new();
    let mut start_index: Option<usize> = None;
    let mut current_midi = 0_i32;

    for (index, frame) in frames.iter().enumerate() {
        if !frame.voiced || frame.confidence < 0.45 {
            if let Some(start) = start_index.take() {
                push_note(&mut output, frames, start, index, current_midi, hop_seconds);
            }
            continue;
        }

        let midi = frame.midi.round() as i32;
        match start_index {
            None => {
                start_index = Some(index);
                current_midi = midi;
            }
            Some(start) if midi != current_midi => {
                push_note(&mut output, frames, start, index, current_midi, hop_seconds);
                start_index = Some(index);
                current_midi = midi;
            }
            Some(_) => {}
        }
    }

    if let Some(start) = start_index {
        push_note(&mut output, frames, start, frames.len(), current_midi, hop_seconds);
    }

    output
}

#[wasm_bindgen]
pub fn analyze_melody(samples: &[f32], sample_rate: u32) -> String {
    let frame_size = ((sample_rate as f32 * 0.050).round() as usize).max(1024);
    let hop_size = ((sample_rate as f32 * 0.040).round() as usize).max(256);
    let hop_seconds = hop_size as f32 / sample_rate.max(1) as f32;
    let mut frames = Vec::new();

    let mut offset = 0usize;
    while offset + frame_size <= samples.len() {
        let frame = &samples[offset..offset + frame_size];
        let mut windowed = vec![0.0_f32; frame_size];
        for (index, sample) in frame.iter().enumerate() {
            let window = 0.5 - 0.5 * ((2.0 * std::f32::consts::PI * index as f32) / frame_size as f32).cos();
            windowed[index] = sample * window;
        }
        let (frequency, confidence) = estimate_pitch(&windowed, sample_rate);
        let midi = if frequency > 0.0 { 69.0 + 12.0 * (frequency / 440.0).log2() } else { 0.0 };
        frames.push(PitchFrame {
            time: offset as f32 / sample_rate.max(1) as f32,
            midi,
            frequency,
            confidence,
            voiced: frequency > 0.0 && (24.0..=96.0).contains(&midi),
        });
        offset += hop_size;
    }

    smooth_frames(&mut frames);
    let notes = segment_notes(&frames, hop_seconds);
    serde_json::to_string(&notes).unwrap_or_else(|_| "[]".to_string())
}
